from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.time import iso_utc, utc_now
from app.files.storage import AssetStorage
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)
from app.schemas.visual_workshop import (
    GenerationModelOptionOut,
    GenerationOptionsOut,
    GenerationTaskCreateIn,
    GenerationTaskListOut,
    GenerationTaskOut,
    ImageGenerationTaskCreateIn,
    VideoGenerationTaskCreateIn,
)

ACTIVE_TASK_STATUSES = ("queued", "submitting", "pending", "processing")
REFERENCE_MIME_TYPES = {
    "image": {"image/jpeg", "image/png", "image/webp", "image/gif"},
    "audio": {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/ogg"},
    "video": {"video/mp4", "video/quicktime", "video/webm"},
}


class GenerationError(Exception):
    def __init__(self, message: str, *, code: str = "generation_error", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def generation_task_out(row: VisualGenerationTask) -> GenerationTaskOut:
    return GenerationTaskOut(
        id=row.id,
        project_id=row.project_id,
        provider_id=row.provider_id,
        model_id=row.model_id,
        provider_kind=row.provider_kind,
        kind=row.generation_kind,
        provider_name=row.provider_name,
        model_slug=row.model_slug,
        request_payload=dict(row.request_payload or {}),
        provider_task_id=row.provider_task_id,
        status=row.status,
        progress=row.progress,
        error_message=row.error_message,
        result_asset_id=row.result_asset_id,
        can_retry_materialization=row.status == "failed" and bool(row.result_url),
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        completed_at=iso_utc(row.completed_at) if row.completed_at else None,
    )


async def has_active_generation_tasks(
    session: AsyncSession, *, provider_id: str | None = None, model_id: str | None = None
) -> bool:
    conditions = [VisualGenerationTask.status.in_(ACTIVE_TASK_STATUSES)]
    if provider_id:
        conditions.append(VisualGenerationTask.provider_id == provider_id)
    if model_id:
        conditions.append(VisualGenerationTask.model_id == model_id)
    count = await session.scalar(select(func.count(VisualGenerationTask.id)).where(*conditions))
    return bool(count)


class VisualGeneration:
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def options(self) -> GenerationOptionsOut:
        rows = (
            await self.session.execute(
                select(ModelEntry, ModelProvider)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelProvider.enabled.is_(True),
                    ModelEntry.enabled.is_(True),
                    ModelProvider.kind.in_(("senseaudio_image", "senseaudio_video")),
                )
                .order_by(ModelProvider.sort_order, ModelEntry.sort_order)
            )
        ).all()
        return GenerationOptionsOut(
            models=[
                GenerationModelOptionOut(
                    id=model.id,
                    provider_id=provider.id,
                    provider_name=provider.name,
                    kind="image" if provider.kind == "senseaudio_image" else "video",
                    slug=model.slug,
                    label=model.label or model.slug,
                    description=model.description,
                    sizes=list(IMAGE_MODEL_SIZES.get(model.slug, ())),
                )
                for model, provider in rows
            ]
        )

    async def _project(self, project_id: str) -> VisualWorkshopProject:
        row = await self.session.get(VisualWorkshopProject, project_id)
        if row is None:
            raise GenerationError("项目不存在", code="not_found", status=404)
        return row

    async def _model(self, model_id: str, kind: str) -> tuple[ModelEntry, ModelProvider]:
        model = await self.session.get(ModelEntry, model_id)
        if model is None:
            raise GenerationError("生成模型不存在", code="model_unavailable", status=404)
        provider = await self.session.get(ModelProvider, model.provider_id)
        capability = f"{kind}_generation"
        expected_provider_kind = f"senseaudio_{kind}"
        if (
            provider is None
            or not provider.enabled
            or not model.enabled
            or provider.kind != expected_provider_kind
            or capability not in list(model.capabilities or [])
        ):
            raise GenerationError("当前生成模型不可用", code="model_unavailable", status=409)
        if not provider.api_key_ciphertext:
            raise GenerationError("供应商尚未配置 API Key", code="missing_api_key", status=409)
        return model, provider

    async def _reference_asset(
        self, project_id: str, asset_id: str, expected_kind: str
    ) -> VisualAsset:
        asset = await self.session.get(VisualAsset, asset_id)
        label = {"image": "参考图片", "audio": "参考音频", "video": "参考视频"}[expected_kind]
        if asset is None:
            raise GenerationError(f"{label}不存在", code="invalid_reference", status=404)
        if (
            asset.media_kind != expected_kind
            or asset.mime_type not in REFERENCE_MIME_TYPES[expected_kind]
        ):
            raise GenerationError(f"{label}格式不受支持", code="invalid_reference")
        in_scope = asset.project_id == project_id
        if not in_scope and asset.project_id is None:
            reference = await self.session.scalar(
                select(VisualProjectAssetReference.id).where(
                    VisualProjectAssetReference.project_id == project_id,
                    VisualProjectAssetReference.asset_id == asset_id,
                )
            )
            if reference:
                in_scope = True
        if not in_scope:
            raise GenerationError(f"{label}不属于当前项目", code="scope_mismatch")
        path = self.storage.path_for(asset)
        if not path.is_file():
            raise GenerationError(f"{label}文件已不存在", code="invalid_reference", status=404)
        if expected_kind == "image" and asset.byte_size > 30 * 1024 * 1024:
            raise GenerationError("单张参考图片不能超过 30 MB", code="reference_too_large")
        if expected_kind == "audio" and asset.byte_size > 15 * 1024 * 1024:
            raise GenerationError("单个参考音频不能超过 15 MB", code="reference_too_large")
        if expected_kind == "video" and asset.byte_size > self.settings.fpl_visual_asset_max_bytes:
            raise GenerationError("单个参考视频超过项目文件上限", code="reference_too_large")
        return asset

    async def _attach_task_to_canvas_node(
        self,
        *,
        project_id: str,
        node_id: str,
        expected_revision: int,
        task_id: str,
        kind: str,
    ) -> None:
        row = await self.session.get(VisualCanvasDocument, project_id)
        if row is None:
            raise GenerationError("项目画布不存在", code="canvas_not_found", status=404)
        nodes = [dict(node) for node in (row.nodes or [])]
        for node in nodes:
            if node.get("id") != node_id:
                continue
            if node.get("kind") != kind:
                raise GenerationError("画布节点类型与生成任务不匹配", code="canvas_kind_mismatch")
            node["generation_task_id"] = task_id
            node["asset_id"] = None
            break
        else:
            raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
        now = utc_now()
        result = await self.session.execute(
            update(VisualCanvasDocument)
            .where(
                VisualCanvasDocument.project_id == project_id,
                VisualCanvasDocument.revision == expected_revision,
            )
            .values(nodes=nodes, revision=expected_revision + 1, updated_at=now)
        )
        if result.rowcount != 1:
            raise GenerationError(
                "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
            )

    async def prepare_create(
        self, project_id: str, body: GenerationTaskCreateIn
    ) -> VisualGenerationTask:
        await self._project(project_id)
        model, provider = await self._model(body.model_id, body.kind)
        payload = body.model_dump(
            mode="json",
            exclude={"canvas_node_id", "expected_canvas_revision"},
        )
        if isinstance(body, ImageGenerationTaskCreateIn):
            sizes = IMAGE_MODEL_SIZES.get(model.slug)
            if not sizes or body.size not in sizes:
                raise GenerationError("当前模型不支持所选图片尺寸", code="unsupported_size")
            prompt_limit = 6000 if model.slug == "senseaudio-image-2.0-260319" else 2000
            if len(body.prompt) > prompt_limit:
                raise GenerationError(
                    f"当前模型提示词最多支持 {prompt_limit} 个字符",
                    code="prompt_too_long",
                )
            if body.reference_asset_id:
                await self._reference_asset(project_id, body.reference_asset_id, "image")
        elif isinstance(body, VideoGenerationTaskCreateIn):
            image_ids = [
                item
                for item in (
                    body.first_frame_asset_id,
                    body.last_frame_asset_id,
                    *body.reference_asset_ids,
                )
                if item
            ]
            for asset_id in image_ids:
                await self._reference_asset(project_id, asset_id, "image")
            for asset_id in body.audio_asset_ids:
                await self._reference_asset(project_id, asset_id, "audio")
            for asset_id in body.video_asset_ids:
                await self._reference_asset(project_id, asset_id, "video")
        row = VisualGenerationTask(
            project_id=project_id,
            provider_id=provider.id,
            model_id=model.id,
            provider_kind=provider.kind,
            generation_kind=body.kind,
            provider_name=provider.name,
            model_slug=model.slug,
            request_payload=payload,
            status="queued",
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def create(self, project_id: str, body: GenerationTaskCreateIn) -> GenerationTaskOut:
        row = await self.prepare_create(project_id, body)
        if body.canvas_node_id is not None and body.expected_canvas_revision is not None:
            await self._attach_task_to_canvas_node(
                project_id=project_id,
                node_id=body.canvas_node_id,
                expected_revision=body.expected_canvas_revision,
                task_id=row.id,
                kind=body.kind,
            )
        await self.session.commit()
        await self.session.refresh(row)
        return generation_task_out(row)

    async def get(self, task_id: str) -> GenerationTaskOut:
        row = await self.session.get(VisualGenerationTask, task_id)
        if row is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        return generation_task_out(row)

    async def list(
        self,
        *,
        project_id: str | None,
        kind: str | None,
        status: str | None,
        page: int,
        page_size: int,
    ) -> GenerationTaskListOut:
        conditions = []
        if project_id:
            conditions.append(VisualGenerationTask.project_id == project_id)
        if kind:
            conditions.append(VisualGenerationTask.generation_kind == kind)
        if status:
            conditions.append(VisualGenerationTask.status == status)
        total = int(
            await self.session.scalar(
                select(func.count(VisualGenerationTask.id)).where(*conditions)
            )
            or 0
        )
        rows = (
            (
                await self.session.execute(
                    select(VisualGenerationTask)
                    .where(*conditions)
                    .order_by(VisualGenerationTask.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            )
            .scalars()
            .all()
        )
        return GenerationTaskListOut(items=[generation_task_out(row) for row in rows], total=total)

    async def retry_materialization(self, task_id: str) -> GenerationTaskOut:
        row = await self.session.get(VisualGenerationTask, task_id)
        if row is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        if row.status != "failed" or not row.result_url:
            raise GenerationError("当前任务没有可重新保存的生成结果", code="retry_unavailable")
        row.status = "processing"
        row.error_message = None
        row.revision += 1
        row.updated_at = utc_now()
        await self.session.commit()
        return generation_task_out(row)
