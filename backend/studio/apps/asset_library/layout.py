"""Owned file-layout upgrade, with no project tables or foreign storage mounts."""

import asyncio
import contextlib
import os
import shutil

from sqlalchemy import func, select, update

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from studio.contracts.asset_library.files import StorageLayoutMigrationOut, StorageLayoutStatusOut
from studio.runtime.files.digests import sha256_file


class StorageLayouts:
    def __init__(self, database, settings):
        self.database, self.settings = database, settings
        self.lock = asyncio.Lock()

    async def _pending(self, owner, limit=None):
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            query = (
                select(VisualAsset)
                .where(
                    VisualAsset.storage_version < TARGET_STORAGE_VERSION,
                )
                .order_by(VisualAsset.created_at, VisualAsset.id)
            )
            if limit is not None:
                query = query.limit(limit)
            return list((await session.scalars(query)).all())

    def _paths(self, asset):
        storage = AssetStorage(self.settings)
        source = storage.legacy_path(asset.storage_key, owner_user_id=asset.owner_user_id)
        target = storage.target_path(
            asset.storage_key,
            owner_user_id=asset.owner_user_id,
            visual_project_id=asset.project_id,
            galgame_project_id=asset.galgame_project_id,
            video_editor_project_id=asset.video_editor_project_id,
            motion_compositor_project_id=asset.motion_compositor_project_id,
        )
        account = self.settings.account_path(asset.owner_user_id)
        if any(
            path.is_symlink() or not path.resolve().is_relative_to(account)
            for path in (source, target)
        ):
            raise ValueError("file path escaped owned storage")
        return source, target

    def _inspect(self, asset):
        source, target = self._paths(asset)
        if not source.is_file():
            return "source_missing"
        if source.stat().st_size != asset.byte_size:
            return "copy_failed"
        if target.exists() and (not target.is_file() or sha256_file(source) != sha256_file(target)):
            return "target_conflict"
        return None

    async def status(self, owner):
        pending = await self._pending(owner)

        def inspect_all():
            missing = conflicts = 0
            for asset in pending:
                try:
                    issue = self._inspect(asset)
                except (OSError, ValueError):
                    issue = "target_conflict"
                missing += issue == "source_missing"
                conflicts += issue in {"target_conflict", "copy_failed"}
            return missing, conflicts

        missing, conflicts = await asyncio.to_thread(inspect_all)
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            migrated = await session.scalar(
                select(func.count())
                .select_from(VisualAsset)
                .where(
                    VisualAsset.storage_version >= TARGET_STORAGE_VERSION,
                )
            )
        return StorageLayoutStatusOut(
            pending_projects=0,
            pending_assets=len(pending),
            migrated_assets=migrated,
            pending_bytes=sum(row.byte_size for row in pending),
            missing_files=missing,
            conflicting_files=conflicts,
            complete=not pending,
        )

    def _copy(self, asset):
        issue = self._inspect(asset)
        if issue:
            return issue, False
        source, target = self._paths(asset)
        if target.exists():
            return None, True
        temp, final = AssetStorage(self.settings).prepare_write(
            asset.storage_key,
            owner_user_id=asset.owner_user_id,
            visual_project_id=asset.project_id,
            galgame_project_id=asset.galgame_project_id,
            video_editor_project_id=asset.video_editor_project_id,
            motion_compositor_project_id=asset.motion_compositor_project_id,
        )
        try:
            with source.open("rb") as reader, temp.open("xb") as writer:
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fsync(writer.fileno())
            if sha256_file(temp) != sha256_file(source):
                return "copy_failed", False
            try:
                os.link(temp, final)
            except FileExistsError:
                if (
                    final.is_symlink()
                    or not final.is_file()
                    or sha256_file(temp) != sha256_file(final)
                ):
                    return "target_conflict", False
                return None, True
            return None, False
        finally:
            temp.unlink(missing_ok=True)

    async def migrate(self, owner, limit):
        if self.lock.locked():
            raise AssetError("文件升级正在执行", code="storage_migration_busy", status=409)
        async with self.lock:
            rows = await self._pending(owner, limit)
            migrated = existing = 0
            issues = []
            for asset in rows:
                # Cancellation cannot interrupt a thread's atomic file publication.
                task = asyncio.create_task(asyncio.to_thread(self._copy, asset))
                try:
                    issue, already = await asyncio.shield(task)
                except asyncio.CancelledError:
                    with contextlib.suppress(Exception):
                        await task
                    raise
                except (OSError, ValueError):
                    issue, already = "copy_failed", False
                if issue:
                    issues.append(
                        {
                            "asset_id": asset.id,
                            "code": issue,
                            "message": "原文件缺失或目标内容尚未核验，原件已保留",
                        }
                    )
                    continue
                async with self.database.sessions() as session:
                    session.info["owner_user_id"] = owner
                    result = await session.execute(
                        update(VisualAsset)
                        .where(
                            VisualAsset.id == asset.id,
                            VisualAsset.storage_version == asset.storage_version,
                        )
                        .values(storage_version=TARGET_STORAGE_VERSION)
                    )
                    await session.commit()
                    if result.rowcount == 1:
                        existing += bool(already)
                        migrated += not already
            remaining = (await self.status(owner)).pending_assets
            return StorageLayoutMigrationOut(
                processed_assets=len(rows),
                migrated_projects=0,
                migrated_assets=migrated,
                already_materialized_assets=existing,
                missing_files=sum(item["code"] == "source_missing" for item in issues),
                conflicts=sum(item["code"] != "source_missing" for item in issues),
                remaining_projects=0,
                remaining_assets=remaining,
                issues=issues,
                complete=remaining == 0,
            )
