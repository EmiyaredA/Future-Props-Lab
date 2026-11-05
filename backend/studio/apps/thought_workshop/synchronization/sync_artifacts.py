"""Private, immutable image copies used by the accepted sync task."""

import hashlib
import os
import re
import shutil
import stat
from pathlib import Path
from uuid import uuid4

from anyio.to_thread import run_sync

from studio.apps.thought_workshop.website.asset_metadata import AssetMetadata
from studio.contracts.integrations.external_sync import ID, ExternalAsset


class SyncArtifacts:
    def __init__(self, state_root: Path):
        self.root = state_root.resolve() / "sync-staging"

    def directory(self, key):
        if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9]{32}", key):
            raise ValueError("同步暂存标识无效")
        path = self.root / key
        if self.root.is_symlink() or path.is_symlink():
            raise ValueError("同步暂存不能经过符号链接")
        return path

    async def capture(self, port: AssetMetadata, asset_ids):
        if not asset_ids:
            return "", []
        key = uuid4().hex
        path = self.directory(key)
        self.root.mkdir(mode=0o700, exist_ok=True)
        path.mkdir(mode=0o700)
        try:
            assets = await port.describe(set(asset_ids))
            result = []
            for asset_id in asset_ids:
                if not re.fullmatch(ID, asset_id):
                    raise ValueError("同步图片标识无效")
                source = assets[asset_id]
                if not 0 < source.byte_size <= 20 * 1024 * 1024:
                    raise ValueError("同步图片大小超出限制")
                destination = path / asset_id
                await port.download(source, destination)
                content_sha = await run_sync(file_sha, destination)
                result.append(
                    ExternalAsset(
                        id=asset_id,
                        filename=source.original_filename,
                        mime=source.mime_type,
                        byte_size=source.byte_size,
                        content_sha=content_sha,
                    )
                )
            return key, result
        except BaseException:
            await self.discard(key)
            raise

    async def discard(self, key):
        if key:
            await run_sync(shutil.rmtree, self.directory(key), True)

    async def sweep(self, active):
        if self.root.is_symlink():
            raise ValueError("同步暂存不能经过符号链接")
        if not self.root.is_dir():
            return
        for path in self.root.iterdir():
            if (
                path.name not in active
                and re.fullmatch(r"[a-f0-9]{32}", path.name)
                and not path.is_symlink()
                and path.is_dir()
            ):
                await self.discard(path.name)

    async def read(self, key, asset: ExternalAsset):
        path = self.directory(key) / asset.id

        def read_verified():
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise ValueError("同步图片暂存无效")
                data = stream.read(asset.byte_size + 1)
            if (
                len(data) != asset.byte_size
                or hashlib.sha256(data).hexdigest() != asset.content_sha
            ):
                raise ValueError("同步图片内容已变化")
            return data

        return await run_sync(read_verified)


def file_sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()
