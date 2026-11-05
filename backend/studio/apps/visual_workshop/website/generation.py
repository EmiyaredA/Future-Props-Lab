from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.capabilities.asset_store.policy import REFERENCE_IMAGE_MIME_TYPES
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.model_service.catalog.visual import generation_options
from studio.apps.model_service.catalog.visual_generation import (
    VisualGenerationValidationError,
    select_visual_model,
)
from studio.apps.model_service.generation.visual_payload import prepare_visual_payload
from studio.apps.model_service.providers.seedance_references import (
    SeedanceReference,
    validate_seedance_references,
)
from studio.apps.model_service.providers.senseaudio_image import IMAGE_MODEL_SIZES
from studio.apps.model_service.providers.volcengine_image import SEEDREAM_SIZES
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.visual_workshop.batch_nodes import attach_grid_nodes
from studio.apps.visual_workshop.generation_common import (
    GenerationError,
    generation_batch_out,
    generation_task_out,
)
from studio.apps.visual_workshop.generation_records import GenerationRecords
from studio.apps.visual_workshop.outputs.history import OutputError
from studio.apps.visual_workshop.outputs.references import resolve_references
from studio.apps.visual_workshop.schemas.generation import (
    GenerationBatchOut,
    ImageCompositionCreateIn,
    ImageGenerationBatchCreateIn,
)
from studio.apps.visual_workshop.schemas.workshop import (
    AudioGenerationTaskCreateIn,
    GenerationTaskCreateIn,
    GenerationTaskOut,
    ImageGenerationTaskCreateIn,
)
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
)
from studio.apps.visual_workshop.website.composition import create_composition, retry_composition
from studio.config.settings import Settings, get_settings
from studio.contracts.model_service.schemas.visual_catalog import GenerationOptionsOut
from studio.runtime.tasks.task_admission import TaskAdmission
from studio.runtime.time import utc_now

REFERENCE_MIME_TYPES = {
    "image": REFERENCE_IMAGE_MIME_TYPES,
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
        return await generation_options(
            self.session, upload_configured=bool(self.settings.fpl_temp_media_upload_url)
        )

    async def _model(
        self, model_id: str, kind: str, audio_mode: str | None = None
    ) -> tuple[ModelEntry, ModelProvider]:
        try:
            return await select_visual_model(
                self.session, self.session.info["owner_user_id"], model_id, kind, audio_mode
            )
        except VisualGenerationValidationError as exc:
            raise GenerationError(str(exc), code=exc.code, status=exc.status) from None

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

        async def reference(identity, kind, *, accepted_mimes=None):
            return await self._reference_asset(
                project_id, identity, kind, accepted_mimes=accepted_mimes
            )

        async def seedance(slug, payload, assets):
            await validate_seedance_references(
                slug,
                payload,
                [
                    SeedanceReference(
                        asset.media_kind, asset.mime_type, self.storage.path_for(asset)
                    )
                    for asset in assets
                ],
                self.settings.fpl_temp_media_upload_url,
            )

        try:
            payload = await prepare_visual_payload(
                body,
                provider_kind=provider.kind,
                model_slug=model.slug,
                explicit_fields=explicit_fields,
                reference_titles=reference_titles,
                input_snapshot=input_snapshot,
                reference=reference,
                validate_seedance=seedance,
            )
        except VisualGenerationValidationError as exc:
            raise GenerationError(str(exc), code=exc.code, status=exc.status) from None
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
