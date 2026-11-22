"""Hash immutable original bytes outside write transactions; cache only exact descriptors."""

import hashlib
import os
import stat
from types import SimpleNamespace

from sqlalchemy import select

from studio.apps.asset_library.storage.content_models import AssetContentFingerprint
from studio.apps.asset_library.storage.models import VisualAsset
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.tasks.blocking_io import run_blocking_io


def snapshot(row):
    return {column.name: getattr(row, column.name) for column in VisualAsset.__table__.columns}


def content_key(owner, kind, size, digest):
    return hashlib.sha256(f"{owner}:{kind}:{size}:{digest}".encode()).hexdigest()


def original_path(files, item):
    path = files.storage.path_for(SimpleNamespace(**item))
    root = files.storage.settings.account_path(files.owner_user_id).resolve()
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise AssetError("素材原件路径无效", code="file_missing", status=409)
    return path


def measure(path, size, cached=None):
    descriptor = None
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != size:
            raise OSError("original size changed")
        descriptor = {
            "size": before.st_size, "mtime": before.st_mtime_ns,
            "ctime": before.st_ctime_ns, "inode": before.st_ino, "device": before.st_dev,
        }
        if cached and cached[0] == descriptor:
            digest = cached[1]
        else:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
        current = path.stat(follow_symlinks=False)
        if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ) or (current.st_ino, current.st_mtime_ns, current.st_size) != (
            before.st_ino, before.st_mtime_ns, before.st_size
        ):
            raise OSError("original changed while hashing")
    return descriptor, digest


class ContentFingerprints:
    def __init__(self, files):
        self.files, self.session, self.owner = files, files.session, files.owner_user_id

    async def candidates(self, project_ids=None, sizes=None):
        condition = [
            VisualAsset.owner_user_id == self.owner,
            VisualAsset.galgame_project_id.is_(None),
            VisualAsset.video_editor_project_id.is_(None),
            VisualAsset.motion_compositor_project_id.is_(None),
            VisualAsset.media_kind.in_(("image", "video", "audio")),
        ]
        if project_ids is not None:
            condition.append(VisualAsset.project_id.is_(None) | VisualAsset.project_id.in_(project_ids))
        if sizes is not None:
            condition.append(VisualAsset.byte_size.in_(sizes))
        rows = await self.session.scalars(select(VisualAsset).where(*condition))
        result = [snapshot(row) for row in rows]
        await self.session.rollback()
        return result

    async def fingerprints(self, items, *, fresh=False):
        result, unavailable = {}, []
        for item in items:
            cached = await self.session.get(AssetContentFingerprint, item["id"])
            cache = (dict(cached.descriptor), cached.sha256) if cached and not fresh else None
            await self.session.rollback()
            try:
                path = original_path(self.files, item)
                descriptor, digest = await run_blocking_io(measure, path, item["byte_size"], cache)
            except (OSError, ValueError, AssetError):
                unavailable.append(item["id"])
                continue
            current = await self.session.get(VisualAsset, item["id"], populate_existing=True)
            if not current or current.owner_user_id != self.owner or any(
                getattr(current, key) != item[key]
                for key in ("storage_key", "storage_version", "byte_size", "revision")
            ):
                await self.session.rollback()
                unavailable.append(item["id"])
                continue
            row = await self.session.get(AssetContentFingerprint, item["id"])
            if row is None:
                row = AssetContentFingerprint(asset_id=item["id"], owner_user_id=self.owner)
                self.session.add(row)
            row.descriptor, row.sha256 = descriptor, digest
            await self.session.commit()
            result[item["id"]] = content_key(self.owner, item["media_kind"], item["byte_size"], digest)
        return result, unavailable
