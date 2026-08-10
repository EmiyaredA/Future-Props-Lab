from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.models import GalgameWorkshopProject, VisualAsset, VisualWorkshopProject
from app.schemas.files import (
    StorageLayoutIssueOut,
    StorageLayoutMigrationOut,
    StorageLayoutStatusOut,
)

_migration_lock = asyncio.Lock()


class LayoutMigrationBusyError(Exception):
    pass


@dataclass(frozen=True)
class PendingAsset:
    id: str
    storage_key: str
    project_id: str | None
    galgame_project_id: str | None
    byte_size: int


async def reconcile_project_trash(session: AsyncSession, storage: AssetStorage) -> None:
    """Restore interrupted deletes and purge directories whose DB delete committed."""
    root = storage.settings.storage_trash_path
    if not root.is_dir():
        return
    project_models = {
        "visual-workshop": VisualWorkshopProject,
        "galgame-workshop": GalgameWorkshopProject,
    }
    for application_id, model in project_models.items():
        application_trash = root / application_id
        if not application_trash.is_dir():
            continue
        for staged_path in application_trash.iterdir():
            if not staged_path.is_dir() or "--trash--" not in staged_path.name:
                continue
            project_id, _separator, nonce = staged_path.name.rpartition("--trash--")
            if not project_id or len(nonce) != 32:
                continue
            original = storage.project_root(application_id, project_id)
            exists = await session.get(model, project_id) is not None
            if exists and not original.exists():
                original.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staged_path, original)
            elif not exists or original.exists():
                shutil.rmtree(staged_path, ignore_errors=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_verified(source: Path, target: Path, expected_size: int) -> None:
    shutil.copyfile(source, target)
    if source.stat().st_size != expected_size or target.stat().st_size != expected_size:
        raise OSError("素材大小与数据库记录不一致")
    if _sha256(source) != _sha256(target):
        raise OSError("素材复制校验失败")


def _same_content(source: Path, target: Path) -> bool:
    return (
        target.is_file()
        and target.stat().st_size == source.stat().st_size
        and _sha256(target) == _sha256(source)
    )


class StorageLayoutMigration:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.storage = AssetStorage(settings)

    async def _projects(self) -> tuple[list[str], list[str]]:
        visual_ids = list(
            (
                await self.session.execute(
                    select(VisualWorkshopProject.id).order_by(VisualWorkshopProject.created_at)
                )
            ).scalars()
        )
        galgame_ids = list(
            (
                await self.session.execute(
                    select(GalgameWorkshopProject.id).order_by(GalgameWorkshopProject.created_at)
                )
            ).scalars()
        )
        return visual_ids, galgame_ids

    async def _pending(self, limit: int | None = None) -> list[PendingAsset]:
        statement = (
            select(
                VisualAsset.id,
                VisualAsset.storage_key,
                VisualAsset.project_id,
                VisualAsset.galgame_project_id,
                VisualAsset.byte_size,
            )
            .where(VisualAsset.storage_version < TARGET_STORAGE_VERSION)
            .order_by(VisualAsset.created_at, VisualAsset.id)
        )
        if limit is not None:
            statement = statement.limit(limit)
        rows = (await self.session.execute(statement)).all()
        return [PendingAsset(*row) for row in rows]

    async def status(self) -> StorageLayoutStatusOut:
        visual_ids, galgame_ids = await self._projects()
        pending_projects = sum(
            not self.storage.project_root(application_id, project_id).is_dir()
            for application_id, project_ids in (
                ("visual-workshop", visual_ids),
                ("galgame-workshop", galgame_ids),
            )
            for project_id in project_ids
        )
        pending = await self._pending()
        migrated = int(
            await self.session.scalar(
                select(func.count(VisualAsset.id)).where(
                    VisualAsset.storage_version >= TARGET_STORAGE_VERSION
                )
            )
            or 0
        )
        missing = conflicts = 0
        for asset in pending:
            source = self.storage.legacy_path(asset.storage_key)
            target = self.storage.target_path(
                asset.storage_key,
                visual_project_id=asset.project_id,
                galgame_project_id=asset.galgame_project_id,
            )
            if not source.is_file():
                missing += 1
            elif target.exists() and not await asyncio.to_thread(_same_content, source, target):
                conflicts += 1
        return StorageLayoutStatusOut(
            pending_projects=pending_projects,
            pending_assets=len(pending),
            migrated_assets=migrated,
            pending_bytes=sum(asset.byte_size for asset in pending),
            missing_files=missing,
            conflicting_files=conflicts,
            complete=pending_projects == 0 and not pending,
        )

    async def migrate(self, limit: int) -> StorageLayoutMigrationOut:
        if _migration_lock.locked():
            raise LayoutMigrationBusyError("素材目录迁移正在进行")
        async with _migration_lock:
            visual_ids, galgame_ids = await self._projects()
            migrated_projects = 0
            for application_id, project_ids in (
                ("visual-workshop", visual_ids),
                ("galgame-workshop", galgame_ids),
            ):
                for project_id in project_ids:
                    if self.storage.ensure_project_layout(application_id, project_id):
                        migrated_projects += 1

            pending = await self._pending(limit)
            await self.session.rollback()
            migrated_assets = already_materialized = missing = conflicts = 0
            issues: list[StorageLayoutIssueOut] = []
            for asset in pending:
                source = self.storage.legacy_path(asset.storage_key)
                target = self.storage.target_path(
                    asset.storage_key,
                    visual_project_id=asset.project_id,
                    galgame_project_id=asset.galgame_project_id,
                )
                temp_path: Path | None = None
                created_target = False
                if not source.is_file():
                    missing += 1
                    issues.append(
                        StorageLayoutIssueOut(
                            asset_id=asset.id,
                            code="source_missing",
                            message="旧版素材文件不存在，记录未迁移",
                        )
                    )
                    continue
                try:
                    if target.exists():
                        same_content = await asyncio.to_thread(_same_content, source, target)
                        if not same_content:
                            conflicts += 1
                            issues.append(
                                StorageLayoutIssueOut(
                                    asset_id=asset.id,
                                    code="target_conflict",
                                    message="目标目录已有不同内容，旧文件已保留",
                                )
                            )
                            continue
                        already_materialized += 1
                    else:
                        temp_path, target = self.storage.prepare_write(
                            asset.storage_key,
                            visual_project_id=asset.project_id,
                            galgame_project_id=asset.galgame_project_id,
                        )
                        await asyncio.to_thread(_copy_verified, source, temp_path, asset.byte_size)
                        os.replace(temp_path, target)
                        created_target = True

                    result = await self.session.execute(
                        update(VisualAsset)
                        .where(
                            VisualAsset.id == asset.id,
                            VisualAsset.storage_version < TARGET_STORAGE_VERSION,
                        )
                        .values(storage_version=TARGET_STORAGE_VERSION)
                    )
                    if result.rowcount != 1:
                        await self.session.rollback()
                        if created_target:
                            target.unlink(missing_ok=True)
                        issues.append(
                            StorageLayoutIssueOut(
                                asset_id=asset.id,
                                code="copy_failed",
                                message="素材记录已并发变化，本次迁移未提交",
                            )
                        )
                        continue
                    await self.session.commit()
                    source.unlink(missing_ok=True)
                    migrated_assets += 1
                except Exception as exc:
                    await self.session.rollback()
                    if temp_path is not None:
                        temp_path.unlink(missing_ok=True)
                    if created_target:
                        target.unlink(missing_ok=True)
                    issues.append(
                        StorageLayoutIssueOut(
                            asset_id=asset.id,
                            code="copy_failed",
                            message=f"素材迁移失败：{type(exc).__name__}",
                        )
                    )

            remaining = await self.status()
            return StorageLayoutMigrationOut(
                processed_assets=len(pending),
                migrated_projects=migrated_projects,
                migrated_assets=migrated_assets,
                already_materialized_assets=already_materialized,
                missing_files=missing,
                conflicts=conflicts,
                remaining_projects=remaining.pending_projects,
                remaining_assets=remaining.pending_assets,
                issues=issues,
                complete=remaining.complete,
            )
