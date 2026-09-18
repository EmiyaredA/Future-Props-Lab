from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.storage import AssetStorage
from app.models import ModelTestGenerationAsset, ModelTestGenerationTask, VisualAsset
from app.runtime.config import Settings, get_settings
from app.runtime.time import iso_utc, utc_now
from app.schemas.model_test import (
    ModelTestGenerationAssetBackfillOut,
    ModelTestGenerationAssetBackfillStatusOut,
    ModelTestGenerationAssetCleanupOut,
    ModelTestGenerationAssetListOut,
    ModelTestGenerationAssetOut,
)

MAX_DRAFT_ASSETS = 15
DRAFT_TTL = timedelta(hours=24)
ACTIVE_STATUSES = {"queued", "submitting", "pending", "processing"}
ROLE_FIELDS = (
    ("reference_asset_ids", "reference_image", "image"),
    ("audio_asset_ids", "reference_audio", "audio"),
    ("video_asset_ids", "reference_video", "video"),
)
ALLOWED_REFERENCES: dict[str, tuple[str, set[str]]] = {
    ".jpg": ("image", {"image/jpeg"}),
    ".jpeg": ("image", {"image/jpeg"}),
    ".png": ("image", {"image/png"}),
    ".webp": ("image", {"image/webp"}),
    ".gif": ("image", {"image/gif"}),
    ".mp3": ("audio", {"audio/mpeg"}),
    ".wav": ("audio", {"audio/wav", "audio/x-wav"}),
    ".mp4": ("video", {"video/mp4"}),
    ".mov": ("video", {"video/quicktime"}),
}


class GenerationAssetError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_asset", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class LegacyAssetSource:
    id: str
    original_filename: str
    media_kind: str
    mime_type: str
    byte_size: int
    path: Path


@dataclass(frozen=True)
class LegacyTaskSnapshot:
    id: str
    workspace_id: str
    status: str
    revision: int
    request_payload: dict


def generation_asset_out(row: ModelTestGenerationAsset) -> ModelTestGenerationAssetOut:
    return ModelTestGenerationAssetOut(
        id=row.id,
        original_filename=row.original_filename,
        media_kind=row.media_kind,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        claimed=row.task_id is not None,
        created_at=iso_utc(row.created_at),
    )


def _looks_like(kind: str, head: bytes) -> bool:
    if kind == "image":
        return head.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a")) or (
            head.startswith(b"RIFF") and head[8:12] == b"WEBP"
        )
    if kind == "audio":
        return head.startswith((b"ID3", b"RIFF", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"))
    return b"ftyp" in head[4:16]


class ModelTestGenerationAssets:
    def __init__(
        self, session: AsyncSession, workspace_id: str, settings: Settings | None = None
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    def _root(self, workspace_id: str | None = None) -> Path:
        return self.settings.workspace_model_test_path(
            workspace_id or self.workspace_id, "references"
        )

    async def upload(self, files: list[IncomingFile]) -> ModelTestGenerationAssetListOut:
        if not files or len(files) > MAX_DRAFT_ASSETS:
            raise GenerationAssetError("每次可上传 1 至 15 个参考素材")
        root = self._root()
        temp_dir = root / ".tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        created: list[tuple[ModelTestGenerationAsset, Path]] = []
        cleanup_paths: set[Path] = set()
        try:
            for upload in files:
                filename = Path(upload.filename or "").name
                extension = Path(filename).suffix.lower()
                config = ALLOWED_REFERENCES.get(extension)
                if not filename or config is None:
                    raise GenerationAssetError("参考素材格式不受支持", code="unsupported_type")
                media_kind, mime_types = config
                mime_type = (upload.content_type or "application/octet-stream").lower()
                if mime_type not in mime_types and mime_type != "application/octet-stream":
                    raise GenerationAssetError("文件扩展名与 MIME 类型不匹配")
                storage_key = uuid4().hex
                temp_path = temp_dir / storage_key
                final_path = root / storage_key
                cleanup_paths.add(temp_path)
                size = 0
                head = bytearray()
                with temp_path.open("xb") as target:
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        limit = (
                            30 * 1024 * 1024
                            if media_kind == "image"
                            else 15 * 1024 * 1024
                            if media_kind == "audio"
                            else self.settings.fpl_visual_asset_max_bytes
                        )
                        if size > limit:
                            raise GenerationAssetError(
                                "参考素材超过大小限制", code="file_too_large", status=413
                            )
                        if len(head) < 512:
                            head.extend(chunk[: 512 - len(head)])
                        target.write(chunk)
                if size == 0 or not _looks_like(media_kind, bytes(head)):
                    raise GenerationAssetError("参考素材内容与声明类型不匹配")
                os.replace(temp_path, final_path)
                cleanup_paths.add(final_path)
                row = ModelTestGenerationAsset(
                    original_filename=filename,
                    storage_key=storage_key,
                    media_kind=media_kind,
                    mime_type=mime_type if mime_type in mime_types else sorted(mime_types)[0],
                    byte_size=size,
                )
                self.session.add(row)
                created.append((row, final_path))
                await upload.close()
            await self.session.commit()
            for row, _path in created:
                await self.session.refresh(row)
            return ModelTestGenerationAssetListOut(
                items=[generation_asset_out(row) for row, _path in created]
            )
        except Exception:
            await self.session.rollback()
            for path in cleanup_paths:
                path.unlink(missing_ok=True)
            for upload in files:
                await upload.close()
            raise

    async def delete_draft(self, asset_id: str) -> None:
        row = await self.session.get(ModelTestGenerationAsset, asset_id)
        if row is None:
            raise GenerationAssetError("参考素材不存在", code="not_found", status=404)
        if row.task_id is not None:
            raise GenerationAssetError("参考素材已被任务使用", code="asset_claimed", status=409)
        path = self._root(row.workspace_id) / row.storage_key
        await self.session.delete(row)
        await self.session.commit()
        path.unlink(missing_ok=True)

    async def claim_for_task(
        self,
        task_id: str,
        groups: tuple[tuple[list[str], str, str], ...],
    ) -> None:
        asset_ids = [asset_id for ids, _role, _kind in groups for asset_id in ids]
        if not asset_ids:
            return
        rows = list(
            (
                await self.session.execute(
                    select(ModelTestGenerationAsset).where(
                        ModelTestGenerationAsset.id.in_(asset_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        inline_image_bytes = 0
        for ids, role, expected_kind in groups:
            for position, asset_id in enumerate(ids):
                row = by_id.get(asset_id)
                if row is None:
                    raise GenerationAssetError(
                        "参考素材不存在或已过期", code="reference_asset_missing", status=404
                    )
                if row.task_id is not None:
                    raise GenerationAssetError(
                        "参考素材已被其他任务使用", code="asset_claimed", status=409
                    )
                if row.media_kind != expected_kind:
                    raise GenerationAssetError("参考素材类型不匹配")
                if not (self._root(row.workspace_id) / row.storage_key).is_file():
                    raise GenerationAssetError(
                        "参考素材文件不存在", code="reference_asset_missing", status=404
                    )
                if expected_kind == "image":
                    inline_image_bytes += row.byte_size
                claimed = await self.session.execute(
                    update(ModelTestGenerationAsset)
                    .where(
                        ModelTestGenerationAsset.id == asset_id,
                        ModelTestGenerationAsset.task_id.is_(None),
                    )
                    .values(task_id=task_id, role=role, position=position)
                    .execution_options(synchronize_session=False)
                )
                if claimed.rowcount != 1:
                    raise GenerationAssetError(
                        "参考素材已被其他任务使用", code="asset_claimed", status=409
                    )
        if inline_image_bytes > 45 * 1024 * 1024:
            raise GenerationAssetError(
                "内联参考图片总大小不能超过 45 MB",
                code="reference_payload_too_large",
                status=413,
            )

    async def task_assets(self, task_id: str) -> list[ModelTestGenerationAsset]:
        return list(
            (
                await self.session.execute(
                    select(ModelTestGenerationAsset)
                    .where(ModelTestGenerationAsset.task_id == task_id)
                    .order_by(ModelTestGenerationAsset.role, ModelTestGenerationAsset.position)
                )
            )
            .scalars()
            .all()
        )

    async def cleanup(self) -> ModelTestGenerationAssetCleanupOut:
        cutoff = utc_now() - DRAFT_TTL
        rows = list(
            (
                await self.session.execute(
                    select(ModelTestGenerationAsset).where(
                        ModelTestGenerationAsset.task_id.is_(None),
                        ModelTestGenerationAsset.created_at < cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        deleted_paths = [self._root(row.workspace_id) / row.storage_key for row in rows]
        if rows:
            await self.session.execute(
                delete(ModelTestGenerationAsset).where(
                    ModelTestGenerationAsset.id.in_([row.id for row in rows])
                )
            )
            await self.session.commit()
        for path in deleted_paths:
            path.unlink(missing_ok=True)
        known = set(
            (await self.session.execute(select(ModelTestGenerationAsset.storage_key))).scalars()
        )
        root = self._root()
        orphan_count = 0
        if root.is_dir():
            for path in root.iterdir():
                if path.name == ".tmp" or not path.is_file() or path.name in known:
                    continue
                stale = utc_now().timestamp() - path.stat().st_mtime >= DRAFT_TTL.total_seconds()
                if stale:
                    path.unlink(missing_ok=True)
                    orphan_count += 1
        temp_dir = root / ".tmp"
        if temp_dir.is_dir():
            for path in temp_dir.iterdir():
                if not path.is_file():
                    continue
                stale = utc_now().timestamp() - path.stat().st_mtime >= DRAFT_TTL.total_seconds()
                if stale:
                    path.unlink(missing_ok=True)
                    orphan_count += 1
        return ModelTestGenerationAssetCleanupOut(
            deleted_assets=len(rows), deleted_orphan_files=orphan_count
        )

    async def backfill_status(self) -> ModelTestGenerationAssetBackfillStatusOut:
        pending = eligible = active = missing = 0
        for task in await self._legacy_tasks():
            pending += 1
            if task.status in ACTIVE_STATUSES:
                active += 1
                continue
            assets = await self._legacy_assets(task)
            if assets is None:
                missing += 1
            else:
                eligible += 1
        return ModelTestGenerationAssetBackfillStatusOut(
            pending_tasks=pending,
            eligible_tasks=eligible,
            active_tasks=active,
            missing_files=missing,
        )

    async def backfill(self, limit: int = 50) -> ModelTestGenerationAssetBackfillOut:
        processed = copied = skipped_active = skipped_missing = conflicts = 0
        tasks = (await self._legacy_tasks())[:limit]
        for task in tasks:
            if task.status in ACTIVE_STATUSES:
                skipped_active += 1
                continue
            legacy = await self._legacy_assets(task)
            if legacy is None:
                skipped_missing += 1
                continue
            task_id = task.id
            expected_revision = task.revision
            prepared: list[tuple[ModelTestGenerationAsset, Path, Path]] = []
            cleanup_paths: set[Path] = set()
            payload = dict(task.request_payload)
            try:
                await self.session.rollback()
                root = self._root(task.workspace_id)
                temp_dir = root / ".tmp"
                temp_dir.mkdir(parents=True, exist_ok=True)
                for field, role, _kind in ROLE_FIELDS:
                    next_ids: list[str] = []
                    for position, source in enumerate(legacy[field]):
                        storage_key = uuid4().hex
                        temp_path = temp_dir / storage_key
                        final_path = root / storage_key
                        cleanup_paths.add(temp_path)
                        await asyncio.to_thread(shutil.copyfile, source.path, temp_path)
                        row = ModelTestGenerationAsset(
                            id=str(uuid4()),
                            task_id=task_id,
                            role=role,
                            position=position,
                            original_filename=source.original_filename,
                            storage_key=storage_key,
                            media_kind=source.media_kind,
                            mime_type=source.mime_type,
                            byte_size=source.byte_size,
                            legacy_visual_asset_id=source.id,
                        )
                        prepared.append((row, temp_path, final_path))
                        next_ids.append(row.id)
                    payload[field] = next_ids
                result = await self.session.execute(
                    update(ModelTestGenerationTask)
                    .where(
                        ModelTestGenerationTask.id == task_id,
                        ModelTestGenerationTask.revision == expected_revision,
                        ModelTestGenerationTask.status.not_in(tuple(ACTIVE_STATUSES)),
                    )
                    .values(
                        request_payload=payload,
                        revision=expected_revision + 1,
                        updated_at=utc_now(),
                    )
                )
                if result.rowcount != 1:
                    conflicts += 1
                    await self.session.rollback()
                    for path in cleanup_paths:
                        path.unlink(missing_ok=True)
                    continue
                self.session.add_all(row for row, _temp, _final in prepared)
                await self.session.flush()
                for _row, temp_path, final_path in prepared:
                    os.replace(temp_path, final_path)
                    cleanup_paths.add(final_path)
                await self.session.commit()
                processed += 1
                copied += len(prepared)
            except Exception:
                await self.session.rollback()
                for path in cleanup_paths:
                    path.unlink(missing_ok=True)
                raise
        remaining = (await self.backfill_status()).pending_tasks
        return ModelTestGenerationAssetBackfillOut(
            processed_tasks=processed,
            copied_assets=copied,
            skipped_active=skipped_active,
            skipped_missing=skipped_missing,
            conflicts=conflicts,
            remaining_tasks=remaining,
        )

    async def _legacy_tasks(self) -> list[LegacyTaskSnapshot]:
        tasks = list(
            (
                await self.session.execute(
                    select(ModelTestGenerationTask).order_by(ModelTestGenerationTask.created_at)
                )
            )
            .scalars()
            .all()
        )
        task_ids = [task.id for task in tasks]
        private_task_ids = set()
        if task_ids:
            private_task_ids = set(
                (
                    await self.session.execute(
                        select(ModelTestGenerationAsset.task_id).where(
                            ModelTestGenerationAsset.task_id.in_(task_ids)
                        )
                    )
                ).scalars()
            )
        return [
            LegacyTaskSnapshot(
                id=task.id,
                workspace_id=task.workspace_id,
                status=task.status,
                revision=task.revision,
                request_payload=dict(task.request_payload or {}),
            )
            for task in tasks
            if task.id not in private_task_ids
            and any((task.request_payload or {}).get(field) for field, _role, _kind in ROLE_FIELDS)
        ]

    async def _legacy_assets(
        self, task: LegacyTaskSnapshot
    ) -> dict[str, list[LegacyAssetSource]] | None:
        payload = dict(task.request_payload)
        ids = [str(item) for field, _role, _kind in ROLE_FIELDS for item in payload.get(field, [])]
        rows = list(
            (await self.session.execute(select(VisualAsset).where(VisualAsset.id.in_(ids))))
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        result: dict[str, list[LegacyAssetSource]] = {}
        for field, _role, expected_kind in ROLE_FIELDS:
            items: list[LegacyAssetSource] = []
            for asset_id in payload.get(field, []):
                row = by_id.get(str(asset_id))
                if row is None or row.media_kind != expected_kind:
                    return None
                path = self.storage.path_for(row)
                if not path.is_file():
                    return None
                items.append(
                    LegacyAssetSource(
                        id=row.id,
                        original_filename=row.original_filename,
                        media_kind=row.media_kind,
                        mime_type=row.mime_type,
                        byte_size=row.byte_size,
                        path=path,
                    )
                )
            result[field] = items
        return result
