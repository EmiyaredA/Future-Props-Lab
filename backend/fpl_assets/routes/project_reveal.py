"""Ensure the owned project directory exists before the local Tools worker opens it."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.project_reveal import ASSETS_PREFIX, reveal_target

from ..project_reveal import prepare_layout

router = APIRouter(include_in_schema=False)


@router.post(ASSETS_PREFIX + "/{application_id}/{project_id}")
async def prepare(request: Request, application_id: str, project_id: str):
    state, path = request.app.state, request.url.path
    if (
        not reveal_target("POST", path, "assets")
        or "cookie" in request.headers
        or "origin" in request.headers
    ):
        raise HTTPException(403, "private_project_reveal_required")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "project_reveal_authorization_required") from None
    if (
        not actor.local
        or actor.purpose != "studio"
        or actor.auth_kind != "session"
        or "content.write"
        not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
    ):
        raise HTTPException(403, "local_access_required")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is None:
        raise HTTPException(503, "identity_unavailable")
    if not active:
        raise HTTPException(403, "authorization_revoked")
    await prepare_layout(state.database, state.settings, actor.user_id, application_id, project_id)
    return {"ready": True}
