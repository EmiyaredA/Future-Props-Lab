"""Pure source and result-node values shared by Visual composition owners."""

from uuid import uuid4

from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.models import VisualGenerationBatch


def composition_items(canvas, body):
    nodes = {str(node.get("id")): node for node in (canvas.nodes or [])}
    source_items: list[dict] = []
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
        source_items.append(
            {
                "node_id": item.node_id,
                "asset_id": item.asset_id,
                "caption": item.caption,
                "binding": "fixed",
                "purpose": "reference",
                "output_id": node.get("final_output_id"),
                "version": node.get("final_version"),
            }
        )
    return source_items


def new_composition(owner, canvas, body, source_items, batch_id):
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
    return result_node, VisualGenerationBatch(
        id=batch_id,
        owner_user_id=owner,
        project_id=canvas.project_id,
        batch_kind="composition",
        grid_size=body.grid_size,
        grid_output="composite",
        child_task_ids=[],
        source_items=source_items,
        status="queued",
        generation_node_id=result_node_id,
    )
