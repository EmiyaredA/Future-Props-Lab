from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.audio_annotation.models import AudioAnnotationDocument, AudioAnnotationProject
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationSegment,
    AudioAnnotationSpeaker,
)
from studio.apps.galgame_workshop.assets.annotation_preview import build_import_preview
from studio.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportTaskOut,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.apps.galgame_workshop.task_views import annotation_task_out as _task_out
from studio.config.settings import Settings, get_settings
from studio.contracts.galgame_workshop.galgame_annotation_source import AnnotationSource


class GalgameAnnotationImports:
    def __init__(
        self, session: AsyncSession, owner_user_id: str, settings: Settings | None = None
    ) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def _target(self, project_id: str) -> GalgameWorkshopProject:
        row = await self.session.get(GalgameWorkshopProject, project_id)
        if row is None:
            raise AssetError("Galgame 项目不存在", code="not_found", status=404)
        return row

    async def preview(
        self, project_id: str, body: GalgameAnnotationImportIn
    ) -> GalgameAnnotationImportPreviewOut:
        await self._target(project_id)
        story = await GalgameStoryDocuments(self.session).get(project_id)
        source = await self.session.get(AudioAnnotationProject, body.source_project_id)
        document_row = await self.session.get(AudioAnnotationDocument, body.source_project_id)
        if source is None or document_row is None:
            raise AssetError("广播剧标注项目不存在", code="not_found", status=404)
        source_asset = await self.session.get(VisualAsset, source.asset_id)
        if source_asset is None or source_asset.media_kind != "audio":
            raise AssetError("广播剧源音频不可用", code="source_audio_missing", status=404)
        source_path = self.storage.path_for(source_asset)
        if not source_path.is_file():
            raise AssetError("广播剧源音频文件不存在", code="source_audio_missing", status=404)

        source_checksum = await asyncio.to_thread(sha256_file, source_path)
        master_asset = await self.session.get(VisualAsset, body.master_asset_id)
        source_metadata = await self.session.get(GalgameAssetMetadata, body.master_asset_id)
        master_matches = not (
            master_asset is None
            or master_asset.media_kind != "audio"
            or master_asset.galgame_project_id not in {None, project_id}
            or source_metadata is None
            or source_metadata.project_id != project_id
            or source_metadata.duration_ms != source.duration_ms
            or source_metadata.checksum_sha256 != source_checksum
        )
        return build_import_preview(
            story,
            body,
            AnnotationSource(
                id=source.id,
                asset_id=source.asset_id,
                duration_ms=source.duration_ms,
                revision=document_row.revision,
                speakers=[
                    AudioAnnotationSpeaker.model_validate(item).model_dump()
                    for item in document_row.speakers
                ],
                segments=[
                    AudioAnnotationSegment.model_validate(item).model_dump()
                    for item in document_row.segments
                ],
            ),
            source_checksum,
            master_matches,
        )

    async def create(
        self, project_id: str, body: GalgameAnnotationImportIn
    ) -> GalgameAnnotationImportTaskOut:
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(GalgameAnnotationImportTask).where(
                GalgameAnnotationImportTask.project_id == project_id,
                GalgameAnnotationImportTask.request_id == body.request_id,
            )
        )
        if existing is not None:
            if existing.request_payload != payload:
                raise AssetError(
                    "同一 requestId 已用于不同导入请求",
                    code="idempotency_conflict",
                    status=409,
                )
            return _task_out(existing)
        preview = await self.preview(project_id, body)
        if not preview.ready:
            raise AssetError(
                "广播剧导入预览未通过",
                code="annotation_import_not_ready",
                detail={"issues": [item.model_dump(mode="json") for item in preview.issues]},
            )
        task = GalgameAnnotationImportTask(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            source_project_id=body.source_project_id,
            request_id=body.request_id,
            expected_source_revision=body.expected_source_revision,
            expected_story_revision=body.expected_story_revision,
            request_payload=payload,
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return _task_out(task)

    async def get(self, project_id: str, import_id: str) -> GalgameAnnotationImportTaskOut:
        await self._target(project_id)
        task = await self.session.get(GalgameAnnotationImportTask, import_id)
        if task is None or task.project_id != project_id:
            raise AssetError("导入任务不存在", code="not_found", status=404)
        return _task_out(task)
