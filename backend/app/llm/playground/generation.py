from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings, get_settings
from app.core.time import iso_utc, utc_now
from app.llm.playground.generation_assets import (
    GenerationAssetError,
    ModelTestGenerationAssets,
)
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.models import (
    ModelEntry,
    ModelProvider,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
)
from app.schemas.model_test import (
    ModelTestGenerationCreateIn,
    ModelTestGenerationOptionListOut,
    ModelTestGenerationOptionOut,
    ModelTestGenerationTaskListOut,
    ModelTestGenerationTaskOut,
    ModelTestImageGenerationIn,
    ModelTestVideoGenerationIn,
)

ACTIVE_GENERATION_STATUSES = ("queued", "submitting", "pending", "processing")


class ModelTestGenerationError(Exception):
    def __init__(self, message: str, *, code: str = "generation_error", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def generation_task_out(row: ModelTestGenerationTask) -> ModelTestGenerationTaskOut:
    return ModelTestGenerationTaskOut(
        id=row.id,
        provider_id=row.provider_id,
        model_id=row.model_id,
        provider_kind=row.provider_kind,
        kind=row.generation_kind,
        provider_name=row.provider_name,
        model_slug=row.model_slug,
        request_payload=dict(row.request_payload or {}),
        status=row.status,
        progress=row.progress,
        error_message=row.error_message,
        result_filename=row.result_filename,
        result_mime_type=row.result_mime_type,
        result_byte_size=row.result_byte_size,
        result_available=bool(row.result_storage_key),
        can_retry_materialization=row.status == "failed" and bool(row.result_url),
        log_id=row.log_id,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        completed_at=iso_utc(row.completed_at) if row.completed_at else None,
    )


class ModelTestGeneration:
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()

    async def _model(self, model_id: str, kind: str) -> tuple[ModelEntry, ModelProvider]:
        model = await self.session.get(ModelEntry, model_id)
        if model is None:
            raise ModelTestGenerationError("生成模型不存在", code="model_unavailable", status=404)
        provider = await self.session.get(ModelProvider, model.provider_id)
        expected_provider_kind = f"senseaudio_{kind}"
        if (
            provider is None
            or not provider.enabled
            or not model.enabled
            or provider.kind != expected_provider_kind
        ):
            raise ModelTestGenerationError(
                "当前生成模型不可用", code="model_unavailable", status=409
            )
        if not provider.api_key_ciphertext:
            raise ModelTestGenerationError(
                "供应商尚未配置 API Key", code="missing_api_key", status=409
            )
        return model, provider

    async def options(self) -> ModelTestGenerationOptionListOut:
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
        return ModelTestGenerationOptionListOut(
            items=[
                ModelTestGenerationOptionOut(
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

    async def create(self, body: ModelTestGenerationCreateIn) -> ModelTestGenerationTaskOut:
        model, provider = await self._model(body.model_id, body.kind)
        payload = body.model_dump(mode="json")
        if isinstance(body, ModelTestImageGenerationIn):
            sizes = IMAGE_MODEL_SIZES.get(model.slug)
            if not sizes or body.size not in sizes:
                raise ModelTestGenerationError(
                    "当前模型不支持所选图片尺寸", code="unsupported_size"
                )
            prompt_limit = 6000 if model.slug == "senseaudio-image-2.0-260319" else 2000
            if len(body.prompt) > prompt_limit:
                raise ModelTestGenerationError(
                    f"当前模型提示词最多支持 {prompt_limit} 个字符",
                    code="prompt_too_long",
                )
        row = ModelTestGenerationTask(
            provider_id=provider.id,
            model_id=model.id,
            provider_kind=provider.kind,
            generation_kind=body.kind,
            provider_name=provider.name,
            model_slug=model.slug,
            request_payload=payload,
            status="queued",
            progress=0,
        )
        self.session.add(row)
        await self.session.flush()
        if isinstance(body, ModelTestVideoGenerationIn):
            try:
                await ModelTestGenerationAssets(self.session, self.settings).claim_for_task(
                    row.id,
                    (
                        (body.reference_asset_ids, "reference_image", "image"),
                        (body.audio_asset_ids, "reference_audio", "audio"),
                        (body.video_asset_ids, "reference_video", "video"),
                    ),
                )
            except GenerationAssetError as exc:
                await self.session.rollback()
                raise ModelTestGenerationError(str(exc), code=exc.code, status=exc.status) from None
        await self.session.commit()
        await self.session.refresh(row)
        return generation_task_out(row)

    async def list(
        self, *, model_id: str | None, page: int, page_size: int
    ) -> ModelTestGenerationTaskListOut:
        conditions = []
        if model_id:
            conditions.append(ModelTestGenerationTask.model_id == model_id)
        total = int(
            await self.session.scalar(
                select(func.count(ModelTestGenerationTask.id)).where(*conditions)
            )
            or 0
        )
        rows = list(
            (
                await self.session.execute(
                    select(ModelTestGenerationTask)
                    .where(*conditions)
                    .order_by(ModelTestGenerationTask.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            )
            .scalars()
            .all()
        )
        return ModelTestGenerationTaskListOut(
            items=[generation_task_out(row) for row in rows], total=total
        )

    async def get(self, task_id: str) -> ModelTestGenerationTaskOut:
        row = await self._row(task_id)
        return generation_task_out(row)

    async def _row(self, task_id: str) -> ModelTestGenerationTask:
        row = await self.session.get(ModelTestGenerationTask, task_id)
        if row is None:
            raise ModelTestGenerationError("测试任务不存在", code="not_found", status=404)
        return row

    async def delete(self, task_id: str, expected_revision: int) -> None:
        row = await self._row(task_id)
        if row.status in ACTIVE_GENERATION_STATUSES:
            raise ModelTestGenerationError("进行中的测试任务不能删除", code="task_busy", status=409)
        if row.revision != expected_revision:
            current = generation_task_out(row).model_dump(mode="json")
            raise RevisionConflictError(expected_revision, row.revision, current)
        result_path = self._result_path(row)
        assets = list(
            (
                await self.session.execute(
                    select(ModelTestGenerationAsset).where(
                        ModelTestGenerationAsset.task_id == task_id
                    )
                )
            )
            .scalars()
            .all()
        )
        asset_paths = [
            self.settings.model_test_reference_path / asset.storage_key for asset in assets
        ]
        result = await self.session.execute(
            delete(ModelTestGenerationTask).where(
                ModelTestGenerationTask.id == task_id,
                ModelTestGenerationTask.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self._row(task_id)
            raise RevisionConflictError(
                expected_revision,
                current.revision,
                generation_task_out(current).model_dump(mode="json"),
            )
        await self.session.commit()
        if result_path:
            result_path.unlink(missing_ok=True)
        for path in asset_paths:
            path.unlink(missing_ok=True)

    async def retry_materialization(self, task_id: str) -> ModelTestGenerationTaskOut:
        row = await self._row(task_id)
        if row.status != "failed" or not row.result_url:
            raise ModelTestGenerationError(
                "当前任务没有可重试保存的生成结果", code="retry_unavailable", status=409
            )
        result = await self.session.execute(
            update(ModelTestGenerationTask)
            .where(
                ModelTestGenerationTask.id == task_id,
                ModelTestGenerationTask.revision == row.revision,
            )
            .values(
                status="processing",
                error_message=None,
                revision=ModelTestGenerationTask.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise ModelTestGenerationError("任务状态已变化，请刷新后重试", status=409)
        await self.session.commit()
        return await self.get(task_id)

    async def content(self, task_id: str) -> tuple[ModelTestGenerationTask, Path]:
        row = await self._row(task_id)
        path = self._result_path(row)
        if path is None or not path.is_file():
            raise ModelTestGenerationError("生成结果不存在", code="not_found", status=404)
        return row, path

    def _result_path(self, row: ModelTestGenerationTask) -> Path | None:
        if not row.result_storage_key:
            return None
        return self.settings.model_test_generated_path / row.result_storage_key
