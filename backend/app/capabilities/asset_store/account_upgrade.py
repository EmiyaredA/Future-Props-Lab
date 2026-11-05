"""Journaled file relocation; database ownership migration never moves files."""

import asyncio
import os
import shutil
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.asset_store.upgrade_records import AccountStorageUpgradeRoot as Root
from studio.runtime.database.ownership import bind_owner
from studio.runtime.files.digests import sha256_file

_lock = asyncio.Lock()


class AccountUpgradeBusyError(Exception):
    pass


def _reject_links(root):
    for base, directories, files in os.walk(root, followlinks=False):
        if any((Path(base) / name).is_symlink() for name in [*directories, *files]):
            raise ValueError("storage upgrade rejects symlinks")


async def upgrade_pending(session) -> bool:
    return bool(
        await session.scalar(
            select(func.count()).select_from(Root).where(Root.status != "completed")
        )
    )


async def upgrade_status(session):
    total = int(await session.scalar(select(func.count()).select_from(Root)) or 0)
    pending = int(
        await session.scalar(
            select(func.count()).select_from(Root).where(Root.status != "completed")
        )
        or 0
    )
    failed = int(
        await session.scalar(select(func.count()).select_from(Root).where(Root.status == "failed"))
        or 0
    )
    return {"total": total, "pending": pending, "failed": failed}


def _path(runtime, relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("invalid upgrade path")
    current = runtime
    for segment in path.parts:
        current = current / segment
        if current.is_symlink():
            raise ValueError("storage upgrade rejects symlinks")
    return current


def _copy_root(runtime, source_key, target_key):
    source = _path(runtime, source_key)
    target = _path(runtime, target_key)
    _reject_links(target)
    if not source.exists():
        return
    # Never overwrite an existing file with a different payload.
    for current, dirs, files in os.walk(source, followlinks=False):
        directory = Path(current)
        if any((directory / name).is_symlink() for name in [*dirs, *files]):
            raise ValueError("storage upgrade rejects symlinks")
        destination = _path(runtime, str(Path(target_key) / directory.relative_to(source)))
        destination.mkdir(parents=True, exist_ok=True)
        for name in files:
            original, final = directory / name, destination / name
            digest = sha256_file(original)
            if final.exists():
                if (
                    final.is_symlink()
                    or final.stat().st_size != original.stat().st_size
                    or sha256_file(final) != digest
                ):
                    raise ValueError("storage upgrade target conflict")
                continue
            staged = destination / (".upgrade-" + uuid4().hex)
            try:
                shutil.copyfile(original, staged)
                if (
                    staged.stat().st_size != original.stat().st_size
                    or sha256_file(staged) != digest
                ):
                    raise ValueError("storage upgrade verification failed")
                with staged.open("rb") as stream:
                    os.fsync(stream.fileno())
                os.replace(staged, final)
            finally:
                staged.unlink(missing_ok=True)
    # Original files are retained until the entire upgrade is verified. They are
    # an inert recovery copy and are never used by normal runtime path resolution.


async def migrate_accounts(session, settings):
    if _lock.locked():
        raise AccountUpgradeBusyError("storage upgrade already running")
    async with _lock:
        ids = list(
            await session.scalars(
                select(Root.id).where(Root.status != "completed").order_by(Root.id)
            )
        )
        await session.rollback()
        for identity in ids:
            row = await session.get(Root, identity)
            source, target = row.source_relative_root, row.target_relative_root
            await session.rollback()
            try:
                await asyncio.to_thread(_copy_root, settings.runtime_path, source, target)
            except Exception:
                row = await session.get(Root, identity)
                row.status, row.error = "failed", "文件迁移失败，请检查源文件或目标冲突后重试"
                await session.commit()
                continue
            row = await session.get(Root, identity)
            row.status, row.error = "completed", ""
            await session.commit()
        storage = AssetStorage(settings)
        roots = list(await session.scalars(select(Root).order_by(Root.id)))
        owners = {row.owner_user_id for row in roots}
        manifests = {
            owner: [row.id for row in roots if row.owner_user_id == owner] for owner in owners
        }
        checks = []
        for owner in owners:
            async with AsyncSession(bind=session.bind, expire_on_commit=False) as reader:
                bind_owner(reader, owner)
                assets = list(
                    await reader.scalars(
                        select(VisualAsset).where(VisualAsset.owner_user_id == owner)
                    )
                )
                checks.extend((owner, storage.path_for(asset), asset.byte_size) for asset in assets)
        await session.rollback()
        failed_owners = set()
        for owner, path, size in checks:
            valid = await asyncio.to_thread(
                lambda p=path, n=size: p.is_file() and p.stat().st_size == n
            )
            if not valid:
                failed_owners.add(owner)
        for owner in failed_owners:
            for identity in manifests[owner]:
                row = await session.get(Root, identity)
                row.status, row.error = "failed", "素材文件缺失或大小与记录不符，请修复后重试"
        await session.commit()
        return await upgrade_status(session)
