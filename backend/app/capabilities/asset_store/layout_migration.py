from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.schemas.files import (
    StorageLayoutIssueOut,
    StorageLayoutMigrationOut,
    StorageLayoutStatusOut,
)
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.orm import LAYOUT_PROJECT_MODELS
from app.runtime.config import Settings

_migration_lock = asyncio.Lock()


class LayoutMigrationBusyError(Exception):
    pass


@dataclass(frozen=True)
class PendingAsset:
    id: str
    storage_key: str
    project_id: str | None
    galgame_project_id: str | None
    video_editor_project_id: str | None
    byte_size: int


async def reconcile_project_trash(session: AsyncSession, storage: AssetStorage) -> None:
    """Restore interrupted deletes and purge directories whose DB delete committed."""
    root = storage.settings.storage_trash_path
    if not root.is_dir():
        return
    project_models = {
        **LAYOUT_PROJECT_MODELS,
    }
    trash_scopes: list[tuple[str, str, Path]] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if child.name in project_models:
            trash_scopes.append(("default", child.name, child))
            continue
        for application_id in project_models:
            application_trash = child / application_id
            if application_trash.is_dir():
                trash_scopes.append((child.name, application_id, application_trash))

    for workspace_id, application_id, application_trash in trash_scopes:
        model = project_models[application_id]
        if not application_trash.is_dir():
            continue
        for staged_path in application_trash.iterdir():
            if not staged_path.is_dir() or "--trash--" not in staged_path.name:
                continue
            project_id, _separator, nonce = staged_path.name.rpartition("--trash--")
            if not project_id or len(nonce) != 32:
                continue
            original = storage.project_root(application_id, project_id, workspace_id=workspace_id)
            row = await session.get(model, project_id)
            exists = row is not None and row.workspace_id == workspace_id
            if exists and not original.exists():
                original.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staged_path, original)
            elif not exists or original.exists():
                shutil.rmtree(staged_path, ignore_errors=True)


async def reconcile_snapshot_imports(session: AsyncSession, storage: AssetStorage) -> None:
    """完成或清理进程中断的项目快照导入。"""
    project_models = {
        **LAYOUT_PROJECT_MODELS,
    }
    markers = list(storage.settings.applications_path.glob("*/projects/*/.snapshot-importing"))
    workspaces_root = storage.settings.runtime_path / "workspaces"
    if workspaces_root.is_dir():
        markers.extend(workspaces_root.glob("*/applications/*/projects/*/.snapshot-importing"))
    for marker in markers:
        project_root = marker.parent
        application_id = project_root.parent.parent.name
        model = project_models.get(application_id)
        if model is None:
            continue
        workspace_id = (
            project_root.parents[3].name
            if project_root.parents[2].name == "applications"
            and project_root.parents[3].parent.name == "workspaces"
            else "default"
        )
        row = await session.get(model, project_root.name)
        if row is not None and row.workspace_id == workspace_id:
            marker.unlink(missing_ok=True)
        else:
            shutil.rmtree(project_root, ignore_errors=True)


def _copy_verified(source: Path, target: Path, expected_size: int) -> None:
    shutil.copyfile(source, target)
    if source.stat().st_size != expected_size or target.stat().st_size != expected_size:
        raise OSError("素材大小与数据库记录不一致")
    if sha256_file(source) != sha256_file(target):
        raise OSError("素材复制校验失败")


def _same_content(source: Path, target: Path) -> bool:
    return (
        target.is_file()
        and target.stat().st_size == source.stat().st_size
        and sha256_file(target) == sha256_file(source)
    )


class StorageLayoutMigration:
    def __init__(self, session: AsyncSession, settings: Settings, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.storage = AssetStorage(settings)

    async def _projects(self) -> tuple[list[str], list[str], list[str]]:
        visual = LAYOUT_PROJECT_MODELS["visual-workshop"]
        galgame = LAYOUT_PROJECT_MODELS["galgame-workshop"]
        video = LAYOUT_PROJECT_MODELS["video-editor"]
        visual_ids = list(
            (await self.session.execute(select(visual.id).order_by(visual.created_at))).scalars()
        )
        galgame_ids = list(
            (await self.session.execute(select(galgame.id).order_by(galgame.created_at))).scalars()
        )
        video_editor_ids = list(
            (await self.session.execute(select(video.id).order_by(video.created_at))).scalars()
        )
        return visual_ids, galgame_ids, video_editor_ids

    async def _pending(self, limit: int | None = None) -> list[PendingAsset]:
        statement = (
            select(
                VisualAsset.id,
                VisualAsset.storage_key,
                VisualAsset.project_id,
                VisualAsset.galgame_project_id,
                VisualAsset.video_editor_project_id,
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
        visual_ids, galgame_ids, video_editor_ids = await self._projects()
        pending_projects = sum(
            not self.storage.project_root(
                application_id, project_id, workspace_id=self.workspace_id
            ).is_dir()
            for application_id, project_ids in (
                ("visual-workshop", visual_ids),
                ("galgame-workshop", galgame_ids),
                ("video-editor", video_editor_ids),
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
                video_editor_project_id=asset.video_editor_project_id,
                workspace_id=self.workspace_id,
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
            visual_ids, galgame_ids, video_editor_ids = await self._projects()
            migrated_projects = 0
            for application_id, project_ids in (
                ("visual-workshop", visual_ids),
                ("galgame-workshop", galgame_ids),
                ("video-editor", video_editor_ids),
            ):
                for project_id in project_ids:
                    if self.storage.ensure_project_layout(
                        application_id, project_id, workspace_id=self.workspace_id
                    ):
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
                    video_editor_project_id=asset.video_editor_project_id,
                    workspace_id=self.workspace_id,
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
                            video_editor_project_id=asset.video_editor_project_id,
                            workspace_id=self.workspace_id,
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
