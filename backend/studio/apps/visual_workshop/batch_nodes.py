from __future__ import annotations

from uuid import uuid4

from sqlalchemy import update

from studio.apps.visual_workshop.generation_common import GenerationError
from studio.apps.visual_workshop.node_placement import (
    NODE_SIZE,
    PLACEMENT_GAP,
    automatic_node_position,
)
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument, VisualGenerationTask
from studio.runtime.time import utc_now


async def attach_grid_nodes(
    service,
    *,
    project_id: str,
    node_id: str,
    expected_revision: int,
    batch_id: str,
    task_ids: list[str],
    grid_size: int,
) -> None:
    row = await service.session.get(VisualCanvasDocument, project_id)
    if row is None:
        raise GenerationError("项目画布不存在", code="canvas_not_found", status=404)
    nodes = [dict(node) for node in (row.nodes or [])]
    root = next((node for node in nodes if node.get("id") == node_id), None)
    if root is None or root.get("kind") != "image":
        raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
    root["generation_batch_id"] = batch_id
    root["generation_task_id"] = task_ids[0]
    await service.session.execute(
        update(VisualGenerationTask)
        .where(VisualGenerationTask.id == task_ids[0])
        .values(canvas_node_id=node_id)
    )
    side = 2 if grid_size == 4 else 3
    width, height = NODE_SIZE["image"]["width"], NODE_SIZE["image"]["height"]
    gap = PLACEMENT_GAP
    for index, task_id in enumerate(task_ids[1:], start=1):
        col, line = index % side, index // side
        child_id = f"image-{uuid4()}"
        await service.session.execute(
            update(VisualGenerationTask)
            .where(VisualGenerationTask.id == task_id)
            .values(canvas_node_id=child_id)
        )
        nodes.append(
            {
                "id": child_id,
                "category_id": root.get("category_id"),
                "group": root.get("group"),
                "tags": root.get("tags", []),
                "kind": "image",
                "title": f"{root.get('title') or '图片'} {index + 1}",
                "position": automatic_node_position(
                    nodes,
                    "image",
                    {
                        "x": float(root.get("position", {}).get("x", 0)) + col * (width + gap),
                        "y": float(root.get("position", {}).get("y", 0)) + line * (height + gap),
                    },
                ),
                "asset_id": None,
                "generation_task_id": task_id,
                "generation_batch_id": batch_id,
            }
        )
    result = await service.session.execute(
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
