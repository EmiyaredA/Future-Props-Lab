"""Report only the capacity facts needed for an admitted Galgame preflight."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.media_rendering.render_capacity import galgame_capacity
from studio.contracts.galgame_workshop.galgame_render import (
    CAPACITY_PREFIX,
    RendererCapacity,
    capacity_target,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions

router = APIRouter(include_in_schema=False)


@router.get(CAPACITY_PREFIX + "/{project_id}", response_model=RendererCapacity)
async def read_capacity(request: Request):
    path = request.url.path
    if (
        "cookie" in request.headers
        or "origin" in request.headers
        or not capacity_target("GET", path)
    ):
        raise HTTPException(403, "galgame_capacity_grant_required")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="rendering",
            method="GET",
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "galgame_capacity_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_capacity_forbidden")
    active = await state.identity.status(assertion=token, method="GET", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_capacity_authority_ended")
    return galgame_capacity(state.settings.runtime_path)
