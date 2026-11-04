"""Find the durable Visual decisions relevant to the current project mutation."""

from sqlalchemy import select

from .models import VisualCanvasReferenceMutation


async def pending_outcomes(session, project_id, conversations=()):
    model = VisualCanvasReferenceMutation
    kind, resource_id = (
        model.change["resource_kind"].as_string(),
        model.change["resource_id"].as_string(),
    )
    scope = (kind == "canvas") & (resource_id == project_id)
    if conversations:
        scope |= (kind == "conversation") & resource_id.in_(conversations)
    identities = list(
        await session.scalars(
            select(model.request_id)
            .where(model.state.in_(("commit", "abort")), scope)
            .order_by(model.created_at, model.request_id)
        )
    )
    await session.rollback()
    return identities
