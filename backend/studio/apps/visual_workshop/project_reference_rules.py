"""Project membership is checked again after resolving the effective generation inputs."""

from sqlalchemy import select

from studio.apps.visual_workshop.outputs.queries import OutputError
from studio.apps.visual_workshop.storage.models import (
    VisualAssetCard,
    VisualCanvasDocument,
    VisualWorkshopProject,
)


async def require_project_design_references(session, project, node_id):
    if node_id is None:
        return
    canvas = await session.get(VisualCanvasDocument, project)
    if canvas is None:
        return
    nodes = {node["id"]: node for node in canvas.nodes or []}
    target = nodes.get(node_id, {})
    card_ids = {
        ref["card_id"]
        for ref in (target.get("generation_draft") or {}).get("design_references", [])
    }
    if target.get("design_card_id"):
        card_ids.add(target["design_card_id"])
    for edge in canvas.edges or []:
        if edge["target_node_id"] == node_id:
            source = nodes.get(edge["source_node_id"], {})
            if source.get("design_card_id"):
                card_ids.add(source["design_card_id"])
    if not card_ids:
        return
    allowed = set(canvas.project_card_ids or [])
    cards = list(
        await session.scalars(select(VisualAssetCard).where(VisualAssetCard.id.in_(card_ids)))
    )
    owner = (await session.get(VisualWorkshopProject, project)).owner_user_id
    valid = {
        card.id for card in cards if card.owner_user_id == owner and not card.data.get("archived")
    }
    if card_ids - allowed or card_ids - valid:
        raise OutputError(
            "参考设定尚未收录到当前项目或已失效，请补收录、替换或移除后生成",
            code="project_card_required",
            status=422,
        )
