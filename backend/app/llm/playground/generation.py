from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.credential_snapshot import CredentialSnapshot
from app.llm.models import (
    ModelEntry,
    ModelProvider,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
)
from app.llm.playground.generation_assets import (
    GenerationAssetError,
    ModelTestGenerationAssets,
)
from app.llm.providers import autodl_workflows
from app.llm.providers.seedance_parameters import normalize_video_parameters, video_capabilities
from app.llm.providers.seedance_references import SeedanceReference, validate_seedance_references
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.llm.providers.volcengine_image import SEEDREAM_MODEL, SEEDREAM_SIZES
from app.llm.providers.zealman_workflows import WORKFLOWS, normalize_request, parameter_options
from app.llm.schemas.model_test import (
    ModelTestGenerationCreateIn,
    ModelTestGenerationOptionListOut,
    ModelTestGenerationOptionOut,
    ModelTestGenerationTaskListOut,
    ModelTestGenerationTaskOut,
    ModelTestImageGenerationIn,
    ModelTestVideoGenerationIn,
)
from app.runtime.config import Settings, get_settings
from app.runtime.image_sizes import ThumbnailSize
from app.runtime.raster import RasterPreviewError, derived_thumbnail
from app.runtime.task_admission import TaskAdmission
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now

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
        execution_info=row.execution_info,
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
    def __init__(
        self, session: AsyncSession, owner_user_id: str, settings: Settings | None = None
    ) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
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
            or provider.kind
            not in (
                {expected_provider_kind, "volcengine_image"}
                if kind == "image"
                else {expected_provider_kind, "zealman_video", "volcengine_video", "autodl_video"}
            )
        ):
            raise ModelTestGenerationError(
                "当前生成模型不可用", code="model_unavailable", status=409
            )
        if provider.kind != "zealman_video" and not provider.api_key_ciphertext:
            raise ModelTestGenerationError(
                "供应商尚未配置 API Key", code="missing_api_key", status=409
            )
        if provider.kind == "volcengine_image" and model.slug != SEEDREAM_MODEL:
            raise ModelTestGenerationError(
                "当前方舟图片适配仅支持 Seedream 4.5", code="unsupported_model"
            )
        try:
            video_capabilities(provider.kind, model.slug)
        except ValueError as exc:
            raise ModelTestGenerationError(str(exc), code="unsupported_model") from None
        return model, provider

    async def options(self) -> ModelTestGenerationOptionListOut:
        rows = (
            await self.session.execute(
                select(ModelEntry, ModelProvider)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelProvider.enabled.is_(True),
                    ModelEntry.enabled.is_(True),
                    ModelProvider.kind.in_(
                        (
                            "senseaudio_image",
                            "volcengine_image",
                            "senseaudio_video",
                            "volcengine_video",
                            "zealman_video",
                            "autodl_video",
                        )
                    ),
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
                    kind="image"
                    if provider.kind in {"senseaudio_image", "volcengine_image"}
                    else "video",
                    slug=model.slug,
                    label=model.label or model.slug,
                    description=model.description,
                    video_capabilities=video_capabilities(
                        provider.kind,
                        model.slug,
                        upload_configured=bool(self.settings.fpl_temp_media_upload_url),
                    ),
                    workflow_capabilities=parameter_options(model.slug)
                    if provider.kind == "zealman_video"
                    else None,
                    sizes=list(
                        SEEDREAM_SIZES
                        if provider.kind == "volcengine_image"
                        else IMAGE_MODEL_SIZES.get(model.slug, ())
                    ),
                )
                for model, provider in rows
                if (provider.kind != "zealman_video" or model.slug in WORKFLOWS)
                and (provider.kind != "autodl_video" or model.slug in autodl_workflows.WORKFLOWS)
                and (
                    provider.kind != "volcengine_video"
                    or model.slug in {"doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"}
                )
            ]
        )

    async def create(
        self,
        body: ModelTestGenerationCreateIn,
        *,
        admission: TaskAdmission | None = None,
        credential: CredentialSnapshot | None = None,
    ) -> ModelTestGenerationTaskOut:
        model, provider = await self._model(body.model_id, body.kind)
        payload = body.model_dump(mode="json")
        if isinstance(body, ModelTestVideoGenerationIn):
            if provider.kind != "autodl_video" and not body.prompt:
                raise ModelTestGenerationError("提示词不能为空", code="unsupported_parameter")
            if provider.kind not in {"volcengine_video", "autodl_video"} and (
                body.duration < 4 or body.mode == "frames"
            ):
                raise ModelTestGenerationError(
                    "当前测试模型不支持所选时长或首尾帧模式", code="unsupported_parameter"
                )
            try:
                payload = normalize_video_parameters(provider.kind, model.slug, payload)
            except ValueError as exc:
                raise ModelTestGenerationError(str(exc), code="unsupported_parameter") from None
            for field, default in (
                {
                    "resolution": "720p",
                    "ratio": "16:9",
                    "watermark": True,
                    "generate_audio": False,
                }
                if provider.kind != "autodl_video"
                else {}
            ).items():
                if payload[field] is None:
                    payload[field] = default
        if isinstance(body, ModelTestImageGenerationIn):
            if provider.kind == "volcengine_image" and body.seed is not None:
                raise ModelTestGenerationError(
                    "Seedream 4.5 不支持指定随机种子", code="unsupported_parameter"
                )
            sizes = (
                SEEDREAM_SIZES
                if provider.kind == "volcengine_image"
                else IMAGE_MODEL_SIZES.get(model.slug)
            )
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
        if isinstance(body, ModelTestVideoGenerationIn):
            if provider.kind == "zealman_video":
                try:
                    payload["workflow_parameters"] = (
                        body.workflow_parameters.model_dump(exclude_unset=True)
                        if body.workflow_parameters
                        else {}
                    )
                    payload = normalize_request(model.slug, payload, body.model_fields_set)
                except ValueError as exc:
                    raise ModelTestGenerationError(str(exc), code="unsupported_parameter") from None
            elif provider.kind != "autodl_video" and body.workflow_parameters is not None:
                raise ModelTestGenerationError(
                    "当前模型不支持工作流参数", code="unsupported_parameter"
                )
        if isinstance(body, ModelTestVideoGenerationIn) and provider.kind == "volcengine_video":
            references = []
            for identity in [
                *body.reference_asset_ids,
                *body.audio_asset_ids,
                *body.video_asset_ids,
                *([body.first_frame_asset_id] if body.first_frame_asset_id else []),
                *([body.last_frame_asset_id] if body.last_frame_asset_id else []),
            ]:
                asset = await self.session.get(ModelTestGenerationAsset, identity)
                if asset is None or asset.task_id is not None:
                    raise ModelTestGenerationError(
                        "参考素材不存在或已被使用", code="reference_asset_missing", status=404
                    )
                references.append(
                    SeedanceReference(
                        asset.media_kind,
                        asset.mime_type,
                        self.settings.account_model_test_path(asset.owner_user_id, "references")
                        / asset.storage_key,
                    )
                )
            try:
                await validate_seedance_references(
                    model.slug, payload, references, self.settings.fpl_temp_media_upload_url
                )
            except ValueError as exc:
                raise ModelTestGenerationError(str(exc), code="invalid_reference") from None
        if isinstance(body, ModelTestVideoGenerationIn) and provider.kind != "autodl_video":
            for identity in [*body.audio_asset_ids, *body.video_asset_ids]:
                asset = await self.session.get(ModelTestGenerationAsset, identity)
                if asset is not None and asset.mime_type in {
                    "audio/flac",
                    "audio/x-flac",
                    "video/webm",
                }:
                    raise ModelTestGenerationError(
                        "当前模型不支持此素材格式", code="invalid_reference"
                    )
        if provider.kind == "autodl_video":
            ids = [
                *body.reference_asset_ids,
                *body.audio_asset_ids,
                *body.video_asset_ids,
                *([body.first_frame_asset_id] if body.first_frame_asset_id else []),
                *([body.last_frame_asset_id] if body.last_frame_asset_id else []),
            ]
            refs = []
            for identity in ids:
                asset = await self.session.get(ModelTestGenerationAsset, identity)
                if (
                    asset is None
                    or asset.owner_user_id != self.owner_user_id
                    or asset.task_id is not None
                ):
                    raise ModelTestGenerationError(
                        "参考素材不存在或已被使用", code="reference_asset_missing", status=404
                    )
                refs.append((asset.media_kind, asset.mime_type, asset.byte_size))
            try:
                autodl_workflows.validate_references(model.slug, refs)
            except ValueError as exc:
                raise ModelTestGenerationError(str(exc), code="invalid_reference") from None
        snap = credential or CredentialSnapshot()
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
            **snap.as_kwargs(),
        )
        self.session.add(row)
        await self.session.flush()
        if isinstance(body, ModelTestVideoGenerationIn):
            try:
                await ModelTestGenerationAssets(
                    self.session, self.owner_user_id, self.settings
                ).claim_for_task(
                    row.id,
                    (
                        (
                            [
                                *body.reference_asset_ids,
                                *([body.first_frame_asset_id] if body.first_frame_asset_id else []),
                                *([body.last_frame_asset_id] if body.last_frame_asset_id else []),
                            ],
                            "reference_image",
                            "image",
                        ),
                        (body.audio_asset_ids, "reference_audio", "audio"),
                        (body.video_asset_ids, "reference_video", "video"),
                    ),
                    max_inline_image_bytes=None
                    if provider.kind == "volcengine_video"
                    else 45 * 1024 * 1024,
                )
            except GenerationAssetError as exc:
                await self.session.rollback()
                raise ModelTestGenerationError(str(exc), code=exc.code, status=exc.status) from None
        if admission:
            await admission([row.id])
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
            self.settings.account_model_test_path(asset.owner_user_id, "references")
            / asset.storage_key
            for asset in assets
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
                log_id=None,
                revision=ModelTestGenerationTask.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise ModelTestGenerationError("任务状态已变化，请刷新后重试", status=409)
        await self.session.commit()
        return await self.get(task_id)

    async def content(
        self, task_id: str, size: ThumbnailSize | None = None
    ) -> tuple[ModelTestGenerationTask, Path]:
        row = await self._row(task_id)
        path = self._result_path(row)
        if path is None or not path.is_file():
            raise ModelTestGenerationError("生成结果不存在", code="not_found", status=404)
        if size is not None:
            if row.kind != "image":
                raise ModelTestGenerationError("此任务不是图片", status=422)
            target = (
                self.settings.account_path(self.owner_user_id)
                / "previews"
                / "model-results"
                / row.id
                / f"{path.stat().st_mtime_ns}-{size}.webp"
            )
            try:
                path = await derived_thumbnail(path, target, size)
            except RasterPreviewError as exc:
                raise ModelTestGenerationError(str(exc), code=exc.code, status=422) from exc
        return row, path

    def _result_path(self, row: ModelTestGenerationTask) -> Path | None:
        if not row.result_storage_key:
            return None
        return (
            self.settings.account_model_test_path(row.owner_user_id, "generated")
            / row.result_storage_key
        )
