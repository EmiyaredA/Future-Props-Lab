"""Find the durable Visual decisions relevant to the current project mutation."""

from sqlalchemy import select

from studio.apps.visual_workshop.storage.service_models import VisualCanvasReferenceMutation


async def pending_outcomes(session, project_id):
    model = VisualCanvasReferenceMutation
    kind, resource_id = (
        model.change["resource_kind"].as_string(),
        model.change["resource_id"].as_string(),
    )
    scope = (kind == "canvas") & (resource_id == project_id)
    scope |= (kind == "acceptance") & (
        (model.change["visual_evidence"]["project_id"].as_string() == project_id)
        | (model.change["visual_review_project"].as_string() == project_id)
    )
    identities = list(
        await session.scalars(
            select(model.request_id)
            .where(model.state.in_(("commit", "abort")), scope)
            .order_by(model.created_at, model.request_id)
        )
    )
    await session.rollback()
    return identities
