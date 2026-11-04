from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.batch_nodes import attach_grid_nodes
from app.apps.visual_workshop.composition import create_composition, retry_composition
from app.apps.visual_workshop.generation_common import (
    GenerationError,
    generation_batch_out,
    generation_task_out,
)
from app.apps.visual_workshop.generation_records import GenerationRecords
from app.apps.visual_workshop.models import (
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
)
from app.apps.visual_workshop.outputs.history import OutputError
from app.apps.visual_workshop.outputs.references import resolve_references
from app.apps.visual_workshop.schemas.generation import (
    GenerationBatchOut,
    ImageCompositionCreateIn,
    ImageGenerationBatchCreateIn,
)
from app.apps.visual_workshop.schemas.workshop import (
    AudioGenerationTaskCreateIn,
    GenerationModelOptionOut,
    GenerationOptionsOut,
    GenerationTaskCreateIn,
    GenerationTaskOut,
    ImageGenerationTaskCreateIn,
    VideoGenerationTaskCreateIn,
)
from app.capabilities.asset_store import download_filename
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.llm.models import (
    ModelEntry,
    ModelProvider,
)
from app.llm.providers import autodl_workflows
from app.llm.providers.seedance_parameters import normalize_video_parameters, video_capabilities
from app.llm.providers.seedance_references import SeedanceReference, validate_seedance_references
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.llm.providers.volcengine_image import SEEDREAM_MODEL, SEEDREAM_SIZES
from app.llm.providers.zealman_workflows import (
    REFERENCE_MIME_TYPES as WORKFLOW_MIME_TYPES,
)
from app.llm.providers.zealman_workflows import (
    WORKFLOWS,
    normalize_request,
    parameter_options,
)
from app.runtime.config import Settings, get_settings
from app.runtime.task_admission import TaskAdmission
from app.runtime.time import utc_now

REFERENCE_MIME_TYPES = {
    "image": {"image/jpeg", "image/png", "image/webp", "image/gif"},
    "audio": {
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/mp4",
        "audio/x-m4a",
        "audio/ogg",
    },
    "video": {"video/mp4", "video/quicktime", "video/webm"},
}


class VisualGeneration(GenerationRecords):
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        super().__init__(session)
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
                    ModelProvider.kind.in_(
                        (
                            "senseaudio_image",
                            "volcengine_image",
                            "senseaudio_video",
                            "volcengine_video",
                            "zealman_video",
                            "autodl_video",
                            "senseaudio_music",
                            "senseaudio_sfx",
                        )
                    ),
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
                    kind=(
                        "image"
                        if provider.kind in {"senseaudio_image", "volcengine_image"}
                        else "video"
                        if provider.kind
                        in {"senseaudio_video", "zealman_video", "volcengine_video", "autodl_video"}
                        else "audio"
                    ),
                    slug=model.slug,
                    label=model.label or model.slug,
                    description=model.description,
                    sizes=list(
                        SEEDREAM_SIZES
                        if provider.kind == "volcengine_image"
                        else IMAGE_MODEL_SIZES.get(model.slug, ())
                    ),
                    max_reference_images=14
                    if provider.kind == "volcengine_image"
                    else 30
                    if provider.kind == "volcengine_video"
                    and model.slug == "doubao-seedance-2-5-260628"
                    else 9
                    if provider.kind in {"zealman_video", "volcengine_video", "autodl_video"}
                    else 1,
                    supports_seed=provider.kind not in {"volcengine_image", "volcengine_video"},
                    max_prompt_length=20000
                    if provider.kind == "autodl_video"
                    else 6000
                    if provider.kind in {"zealman_video", "autodl_video"}
                    or model.slug == "senseaudio-image-2.0-260319"
                    else 2000,
                    video_capabilities=video_capabilities(
                        provider.kind,
                        model.slug,
                        upload_configured=bool(self.settings.fpl_temp_media_upload_url),
                    ),
                    workflow_capabilities=(
                        parameter_options(model.slug) if provider.kind == "zealman_video" else None
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

    async def _model(
        self, model_id: str, kind: str, audio_mode: str | None = None
    ) -> tuple[ModelEntry, ModelProvider]:
        model = await self.session.get(ModelEntry, model_id)
        if model is None:
            raise GenerationError("生成模型不存在", code="model_unavailable", status=404)
        provider = await self.session.get(ModelProvider, model.provider_id)
        capability = f"{kind}_generation"
        expected_provider_kind = (
            f"senseaudio_{audio_mode}" if kind == "audio" else f"senseaudio_{kind}"
        )
        if (
            provider is None
            or not provider.enabled
            or not model.enabled
            or provider.kind
            not in (
                {"senseaudio_image", "volcengine_image"}
                if kind == "image"
                else {"senseaudio_video", "zealman_video", "volcengine_video", "autodl_video"}
                if kind == "video"
                else {expected_provider_kind}
            )
            or capability not in list(model.capabilities or [])
        ):
            raise GenerationError("当前生成模型不可用", code="model_unavailable", status=409)
        if provider.kind != "zealman_video" and not provider.api_key_ciphertext:
            raise GenerationError("供应商尚未配置 API Key", code="missing_api_key", status=409)
        if provider.kind == "volcengine_image" and model.slug != SEEDREAM_MODEL:
            raise GenerationError("当前方舟图片适配仅支持 Seedream 4.5", code="unsupported_model")
        try:
            video_capabilities(provider.kind, model.slug)
        except ValueError as exc:
            raise GenerationError(str(exc), code="unsupported_model") from None
        return model, provider

    async def _reference_asset(
        self,
        project_id: str,
        asset_id: str,
        expected_kind: str,
        *,
        accepted_mimes: set[str] | None = None,
    ) -> VisualAsset:
        asset = await self.session.get(VisualAsset, asset_id)
        label = {"image": "参考图片", "audio": "参考音频", "video": "参考视频"}[expected_kind]
        if asset is None:
            raise GenerationError(f"{label}不存在", code="invalid_reference", status=404)
        if asset.media_kind != expected_kind or asset.mime_type not in (
            accepted_mimes if accepted_mimes is not None else REFERENCE_MIME_TYPES[expected_kind]
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
            # Preserve the chosen final output while a new run is active.
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

    async def _resolve_canvas_references(
        self, project_id, body, *, frame_constraints=True, frame_reference_slots=False
    ):
        try:
            return await resolve_references(
                self.session,
                project_id,
                body,
                frame_constraints=frame_constraints,
                frame_reference_slots=frame_reference_slots,
            )
        except OutputError as exc:
            raise GenerationError(str(exc), code=exc.code, status=exc.status) from None

    async def prepare_create(
        self, project_id: str, body: GenerationTaskCreateIn
    ) -> VisualGenerationTask:
        await self._project(project_id)
        explicit_fields = body.model_fields_set.copy()
        model, provider = await self._model(
            body.model_id,
            body.kind,
            body.mode if isinstance(body, AudioGenerationTaskCreateIn) else None,
        )
        body, reference_titles, input_snapshot = await self._resolve_canvas_references(
            project_id,
            body,
            frame_constraints=provider.kind != "zealman_video",
            frame_reference_slots=provider.kind == "autodl_video"
            and model.slug == "minimax_h3_lightx2v",
        )
        payload = body.model_dump(
            mode="json",
            exclude={"canvas_node_id", "expected_canvas_revision"},
        )
        payload["input_snapshot"] = input_snapshot
        reference_assets: dict[str, VisualAsset] = {}
        if isinstance(body, ImageGenerationTaskCreateIn):
            sizes = (
                SEEDREAM_SIZES
                if provider.kind == "volcengine_image"
                else IMAGE_MODEL_SIZES.get(model.slug)
            )
            if not sizes or body.size not in sizes:
                raise GenerationError("当前模型不支持所选图片尺寸", code="unsupported_size")
            prompt_limit = 6000 if model.slug == "senseaudio-image-2.0-260319" else 2000
            if len(body.prompt) > prompt_limit:
                raise GenerationError(
                    f"当前模型提示词最多支持 {prompt_limit} 个字符",
                    code="prompt_too_long",
                )
            reference_ids = list(
                dict.fromkeys(
                    [
                        *body.reference_asset_ids,
                        *([body.reference_asset_id] if body.reference_asset_id else []),
                    ]
                )
            )
            if len(reference_ids) > (14 if provider.kind == "volcengine_image" else 1):
                raise GenerationError(
                    "当前图片模型不支持所选参考图数量", code="too_many_references"
                )
            if provider.kind == "volcengine_image" and body.seed is not None:
                raise GenerationError(
                    "Seedream 4.5 不支持指定随机种子", code="unsupported_parameter"
                )
            for reference_id in reference_ids:
                reference_assets[reference_id] = await self._reference_asset(
                    project_id, reference_id, "image"
                )
                if provider.kind == "volcengine_image" and reference_assets[
                    reference_id
                ].mime_type not in {"image/png", "image/jpeg", "image/webp"}:
                    raise GenerationError(
                        "Seedream 4.5 参考图仅支持 PNG、JPEG、WebP",
                        code="unsupported_reference_format",
                    )
            payload["reference_asset_ids"] = reference_ids
            payload["reference_asset_id"] = reference_ids[0] if len(reference_ids) == 1 else None
        elif isinstance(body, VideoGenerationTaskCreateIn):
            try:
                payload = normalize_video_parameters(provider.kind, model.slug, payload)
            except ValueError as exc:
                raise GenerationError(str(exc), code="unsupported_parameter") from None
            if provider.kind == "zealman_video":
                try:
                    payload["workflow_parameters"] = (
                        body.workflow_parameters.model_dump(exclude_unset=True)
                        if body.workflow_parameters
                        else {}
                    )
                    payload = normalize_request(model.slug, payload, explicit_fields)
                except ValueError as exc:
                    raise GenerationError(str(exc), code="unsupported_parameter") from None
            elif provider.kind != "autodl_video" and body.workflow_parameters is not None:
                raise GenerationError("当前模型不支持工作流参数", code="unsupported_parameter")
            if provider.kind not in {"zealman_video", "autodl_video"}:
                for field, default in {
                    "resolution": "720p",
                    "ratio": "16:9",
                    "watermark": True,
                    "generate_audio": False,
                }.items():
                    if payload.get(field) is None:
                        payload[field] = default
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
                reference_assets[asset_id] = await self._reference_asset(
                    project_id, asset_id, "image"
                )
            for asset_id in body.audio_asset_ids:
                reference_assets[asset_id] = await self._reference_asset(
                    project_id,
                    asset_id,
                    "audio",
                    accepted_mimes=set(
                        autodl_workflows.capabilities(model.slug).reference_mime_types["audio"]
                    )
                    if provider.kind == "autodl_video"
                    else None,
                )
            for asset_id in body.video_asset_ids:
                reference_assets[asset_id] = await self._reference_asset(
                    project_id, asset_id, "video"
                )
            if provider.kind == "zealman_video":
                if sum(asset.byte_size for asset in reference_assets.values()) > 45 * 1024 * 1024:
                    raise GenerationError(
                        "参考素材总大小不能超过 45 MB", code="reference_too_large"
                    )
                if any(
                    asset.mime_type not in WORKFLOW_MIME_TYPES[asset.media_kind]
                    for asset in reference_assets.values()
                ):
                    raise GenerationError("工作流不支持所选素材格式", code="invalid_reference")
            if provider.kind == "autodl_video":
                try:
                    autodl_workflows.validate_references(
                        model.slug,
                        [
                            (a.media_kind, a.mime_type, a.byte_size)
                            for a in reference_assets.values()
                        ],
                    )
                except ValueError as exc:
                    raise GenerationError(str(exc), code="invalid_reference") from None
            if provider.kind == "volcengine_video":
                try:
                    await validate_seedance_references(
                        model.slug,
                        payload,
                        [
                            SeedanceReference(
                                asset.media_kind, asset.mime_type, self.storage.path_for(asset)
                            )
                            for asset in reference_assets.values()
                        ],
                        self.settings.fpl_temp_media_upload_url,
                    )
                except ValueError as exc:
                    raise GenerationError(str(exc), code="invalid_reference") from None
        elif isinstance(body, AudioGenerationTaskCreateIn):
            for asset_id in body.reference_asset_ids:
                reference_assets[asset_id] = await self._reference_asset(
                    project_id, asset_id, "audio"
                )
        if reference_titles:
            payload["reference_filenames"] = {
                asset_id: download_filename(title, reference_assets[asset_id].original_filename)
                for asset_id, title in reference_titles.items()
                if asset_id in reference_assets
            }
        row = VisualGenerationTask(
            owner_user_id=(await self._project(project_id)).owner_user_id,
            project_id=project_id,
            provider_id=provider.id,
            model_id=model.id,
            provider_kind=provider.kind,
            generation_kind=body.kind,
            provider_name=provider.name,
            model_slug=model.slug,
            request_payload=payload,
            canvas_node_id=body.canvas_node_id,
            status="queued",
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def create(
        self,
        project_id: str,
        body: GenerationTaskCreateIn,
        *,
        admission: TaskAdmission | None = None,
    ) -> GenerationTaskOut:
        row = await self.prepare_create(project_id, body)
        if body.canvas_node_id is not None and body.expected_canvas_revision is not None:
            await self._attach_task_to_canvas_node(
                project_id=project_id,
                node_id=body.canvas_node_id,
                expected_revision=body.expected_canvas_revision,
                task_id=row.id,
                kind=body.kind,
            )
        if admission:
            await admission([row.id])
        await self.session.commit()
        await self.session.refresh(row)
        return generation_task_out(row)

    async def create_batch(
        self,
        project_id: str,
        body: ImageGenerationBatchCreateIn,
        *,
        admission: TaskAdmission | None = None,
    ) -> GenerationBatchOut:
        await self._project(project_id)
        if body.grid_size not in (4, 9):
            raise GenerationError("宫格数量必须为 4 或 9", code="invalid_grid_size")
        model, provider = await self._model(body.model_id, "image")
        sizes = (
            SEEDREAM_SIZES
            if provider.kind == "volcengine_image"
            else IMAGE_MODEL_SIZES.get(model.slug)
        )
        if not sizes or body.size not in sizes:
            raise GenerationError("当前模型不支持所选图片尺寸", code="unsupported_size")
        prompt_limit = 6000 if model.slug == "senseaudio-image-2.0-260319" else 2000
        if len(body.prompt) > prompt_limit:
            raise GenerationError(
                f"当前模型提示词最多支持 {prompt_limit} 个字符", code="prompt_too_long"
            )
        resolved_body, _, input_snapshot = await self._resolve_canvas_references(
            project_id,
            ImageGenerationTaskCreateIn(
                kind="image",
                model_id=body.model_id,
                prompt=body.prompt,
                size=body.size,
                seed=body.seed,
                reference_asset_id=body.reference_asset_id,
                reference_asset_ids=body.reference_asset_ids,
                canvas_node_id=body.canvas_node_id,
                expected_canvas_revision=body.expected_canvas_revision,
            ),
        )
        resolved_reference_id = resolved_body.reference_asset_id
        resolved_reference_ids = resolved_body.reference_asset_ids
        if resolved_reference_id:
            await self._reference_asset(project_id, resolved_reference_id, "image")
        batch_id = str(uuid4())
        task_ids: list[str] = []
        for index in range(body.grid_size):
            task_body = ImageGenerationTaskCreateIn(
                kind="image",
                model_id=body.model_id,
                prompt=resolved_body.prompt,
                size=body.size,
                seed=body.seed + index if body.seed is not None else None,
                reference_asset_id=resolved_reference_id,
                reference_asset_ids=resolved_reference_ids,
                canvas_node_id=None,
                expected_canvas_revision=None,
            )
            row = await self.prepare_create(project_id, task_body)
            payload = dict(row.request_payload or {})
            payload["input_snapshot"] = input_snapshot
            payload["generation_batch_id"] = batch_id
            payload["generation_batch_index"] = index
            row.request_payload = payload
            task_ids.append(row.id)
        batch = VisualGenerationBatch(
            id=batch_id,
            owner_user_id=(await self._project(project_id)).owner_user_id,
            project_id=project_id,
            grid_size=body.grid_size,
            grid_output=body.grid_output,
            child_task_ids=task_ids,
            generation_node_id=body.canvas_node_id,
            status="queued",
        )
        self.session.add(batch)
        await self.session.flush()
        if body.grid_output == "nodes" and body.canvas_node_id is not None:
            await self._attach_grid_nodes_to_canvas(
                project_id=project_id,
                node_id=body.canvas_node_id,
                expected_revision=body.expected_canvas_revision or 0,
                batch_id=batch_id,
                task_ids=task_ids,
                grid_size=body.grid_size,
            )
        if body.grid_output == "composite" and body.canvas_node_id is not None:
            await self._attach_batch_to_canvas_node(
                project_id=project_id,
                node_id=body.canvas_node_id,
                expected_revision=body.expected_canvas_revision or 0,
                batch_id=batch_id,
            )
        if admission:
            await admission(task_ids)
        await self.session.commit()
        await self.session.refresh(batch)
        return generation_batch_out(batch)

    async def create_composition(
        self, project_id: str, body: ImageCompositionCreateIn
    ) -> GenerationBatchOut:
        return await create_composition(self, project_id, body)

    async def retry_composition(self, batch_id: str) -> GenerationBatchOut:
        return await retry_composition(self, batch_id)

    async def _attach_grid_nodes_to_canvas(
        self,
        *,
        project_id: str,
        node_id: str,
        expected_revision: int,
        batch_id: str,
        task_ids: list[str],
        grid_size: int,
    ) -> None:
        await attach_grid_nodes(
            self,
            project_id=project_id,
            node_id=node_id,
            expected_revision=expected_revision,
            batch_id=batch_id,
            task_ids=task_ids,
            grid_size=grid_size,
        )

    async def _attach_batch_to_canvas_node(
        self, *, project_id: str, node_id: str, expected_revision: int, batch_id: str
    ) -> None:
        row = await self.session.get(VisualCanvasDocument, project_id)
        if row is None:
            raise GenerationError("项目画布不存在", code="canvas_not_found", status=404)
        nodes = [dict(node) for node in (row.nodes or [])]
        for node in nodes:
            if node.get("id") == node_id:
                if node.get("kind") != "image":
                    raise GenerationError(
                        "画布节点类型与生成任务不匹配", code="canvas_kind_mismatch"
                    )
                node["generation_batch_id"] = batch_id
                node["generation_task_id"] = None
                # Preserve the chosen final output while a new run is active.
                break
        else:
            raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
        result = await self.session.execute(
            update(VisualCanvasDocument)
            .where(
                VisualCanvasDocument.project_id == project_id,
                VisualCanvasDocument.revision == expected_revision,
            )
            .values(nodes=nodes, revision=expected_revision + 1, updated_at=utc_now())
        )
        if result.rowcount != 1:
            raise GenerationError(
                "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
            )
