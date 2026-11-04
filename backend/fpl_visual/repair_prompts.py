"""Apply a repair prompt within the draft's Canvas transaction."""

from app.apps.visual_workshop.acceptance.review_records import ReviewRecords
from app.apps.visual_workshop.canvas_asset_values import existing_assets, expected_assets
from app.apps.visual_workshop.canvas_documents import CanvasDocuments, VisualCanvasError

from .segment_handoffs import require_canvas_unreserved


async def write_repair(session, owner, project_id, draft_id, body):
    async def verify_assets(_project_id, nodes, previous):
        if {asset_id for asset_id, _ in expected_assets(nodes)} != existing_assets(previous):
            raise VisualCanvasError("返修只能修改提示词", code="invalid_repair_references")

    async def replace_canvas(identity, document):
        await require_canvas_unreserved(session, owner, identity)
        return await CanvasDocuments(session, validate_assets=verify_assets).replace(
            identity, document
        )

    return await ReviewRecords(session, owner).write_repair(
        project_id, draft_id, body, replace_canvas=replace_canvas
    )
