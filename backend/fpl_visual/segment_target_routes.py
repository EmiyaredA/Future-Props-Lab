"""Read a Visual target's owned canvas revision from a Video segment request."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.video_segment_handoff import TARGETS

from .projects import Projects

router = APIRouter(include_in_schema=False)


@router.get(TARGETS + "/{project_id}")
async def target_revision(request: Request, project_id: str):
    state = request.app.state
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_segment_target_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="visual",
            method="GET",
            path=request.url.path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "segment_target_authorization_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "segment_target_write_required")
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        canvas = await Projects(session, actor.user_id).canvas_row(project_id)
        return {"revision": canvas.revision}
