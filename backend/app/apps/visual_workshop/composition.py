from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import update

from app.apps.visual_workshop.generation_common import GenerationError, generation_batch_out
from app.apps.visual_workshop.models import VisualCanvasDocument, VisualGenerationBatch
from app.apps.visual_workshop.schemas.generation import GenerationBatchOut, ImageCompositionCreateIn
from app.runtime.time import utc_now

if TYPE_CHECKING:
    from app.apps.visual_workshop.generation import VisualGeneration


async def create_composition(
    service: VisualGeneration, project_id: str, body: ImageCompositionCreateIn
) -> GenerationBatchOut:
    await service._project(project_id)
    canvas = await service.session.get(VisualCanvasDocument, project_id)
    if canvas is None:
        raise GenerationError("项目画布不存在", code="canvas_not_found", status=404)
    if canvas.revision != body.expected_canvas_revision:
        raise GenerationError(
            "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
        )
    nodes = {str(node.get("id")): node for node in (canvas.nodes or [])}
    source_items: list[dict[str, str]] = []
    for item in body.items:
        node = nodes.get(item.node_id)
        if node is None:
            raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
        if node.get("kind") != "image":
            raise GenerationError("宫格合成仅支持图片节点", code="canvas_kind_mismatch")
        if node.get("asset_id") != item.asset_id:
            raise GenerationError(
                "图片节点素材已变化，请刷新后重试", code="stale_asset", status=409
            )
        await service._reference_asset(project_id, item.asset_id, "image")
        source_items.append(
            {"node_id": item.node_id, "asset_id": item.asset_id, "caption": item.caption}
        )
    batch_id = str(uuid4())
    result_node_id = f"image-{uuid4()}"
    title = body.title.strip() or f"{body.grid_size}宫格合成"
    result_node = {
        "id": result_node_id,
        "kind": "image",
        "title": title,
        "position": body.result_position.model_dump(mode="json"),
        "asset_id": None,
        "generation_task_id": None,
        "generation_batch_id": batch_id,
    }
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
    batch = VisualGenerationBatch(
        id=batch_id,
        workspace_id=str(service.session.info.get("workspace_id", "default")),
        project_id=project_id,
        batch_kind="composition",
        grid_size=body.grid_size,
        grid_output="composite",
        child_task_ids=[],
        source_items=source_items,
        status="queued",
        generation_node_id=result_node_id,
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
