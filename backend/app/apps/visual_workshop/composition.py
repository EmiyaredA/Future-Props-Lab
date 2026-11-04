from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import update

from app.apps.visual_workshop.composition_values import composition_items, new_composition
from app.apps.visual_workshop.generation_common import GenerationError, generation_batch_out
from app.apps.visual_workshop.models import VisualCanvasDocument, VisualGenerationBatch
from app.apps.visual_workshop.schemas.generation import GenerationBatchOut, ImageCompositionCreateIn
from app.runtime.time import utc_now

if TYPE_CHECKING:
    from app.apps.visual_workshop.generation import VisualGeneration


async def create_composition(
    service: VisualGeneration, project_id: str, body: ImageCompositionCreateIn
) -> GenerationBatchOut:
    project = await service._project(project_id)
    canvas = await service.session.get(VisualCanvasDocument, project_id)
    if canvas is None:
        raise GenerationError("项目画布不存在", code="canvas_not_found", status=404)
    if canvas.revision != body.expected_canvas_revision:
        raise GenerationError(
            "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
        )
    source_items = composition_items(canvas, body)
    for item in source_items:
        await service._reference_asset(project_id, item["asset_id"], "image")
    result_node, batch = new_composition(
        project.owner_user_id, canvas, body, source_items, str(uuid4())
    )
    result = await service.session.execute(
        update(VisualCanvasDocument)
        .where(
            VisualCanvasDocument.project_id == project_id,
            VisualCanvasDocument.revision == body.expected_canvas_revision,
        )
        .values(
            nodes=[*(canvas.nodes or []), result_node],
            revision=body.expected_canvas_revision + 1,
            updated_at=utc_now(),
        )
    )
    if result.rowcount != 1:
        raise GenerationError(
            "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
        )
    service.session.add(batch)
    await service.session.commit()
    await service.session.refresh(batch)
    return generation_batch_out(batch)


async def retry_composition(service: VisualGeneration, batch_id: str) -> GenerationBatchOut:
    batch = await service.session.get(VisualGenerationBatch, batch_id)
    if batch is None:
        raise GenerationError("生成批次不存在", code="not_found", status=404)
    if batch.batch_kind != "composition":
        raise GenerationError("当前批次不是节点合成批次", code="retry_unavailable")
    if batch.status != "failed" or batch.result_asset_id:
        raise GenerationError("当前批次没有可重新合成的结果", code="retry_unavailable")
    for item in batch.source_items or []:
        await service._reference_asset(batch.project_id, str(item.get("asset_id") or ""), "image")
    batch.status = "queued"
    batch.error_message = None
    batch.completed_at = None
    batch.updated_at = utc_now()
    batch.revision += 1
    await service.session.commit()
    return generation_batch_out(batch)
