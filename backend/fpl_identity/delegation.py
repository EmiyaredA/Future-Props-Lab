"""Issue narrow target assertions from an authenticated, still-active source request."""

import secrets
from dataclasses import replace
from typing import Literal

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from fpl_runtime.claims import issue_context, verify_context
from fpl_runtime.delegation import RequestGrant, permitted

from .live import active_actor

router = APIRouter()


class DelegationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caller: str = Field(min_length=1, max_length=64)
    purpose: str = Field(min_length=1, max_length=100)
    source_method: Literal["POST"]
    source_path: str = Field(max_length=4096)
    target_service: str = Field(max_length=64)
    target_method: Literal["GET"]
    target_path: str = Field(max_length=4096)
    assertion: str = Field(min_length=1, max_length=8192)


async def authorize_delegation(app, body, credential):
    options = app.identity_options
    expected = options["service_credentials"].get(body.caller)
    if expected is None or not secrets.compare_digest(expected, credential):
        raise HTTPException(403, "service_credential_required")
    grant = RequestGrant(**body.model_dump(exclude={"assertion"}))
    if not permitted(grant, app.service_catalog):
        raise HTTPException(403, "delegation_not_permitted")
    try:
        actor = verify_context(
            body.assertion,
            service=body.caller,
            method=body.source_method,
            path=body.source_path,
            public_key=options["private_key"].public_key(),
            allow_expired=True,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
        raise HTTPException(401, "invalid_source_assertion") from exc
    async with app.database.sessions() as session:
        if not await active_actor(session, actor):
            raise HTTPException(401, "source_authorization_revoked")
    principal = StudioPrincipal(
        user_id=actor.user_id,
        platform_role=actor.platform_role,
        must_change_password=False,
        auth_kind=actor.auth_kind,
        scopes=frozenset(actor.scopes),
        session_id=actor.session_id,
        api_key_id=actor.api_key_id,
    )
    permission = route_permission(body.target_method, body.target_path)
    if permission is None or not principal.allows(permission):
        raise HTTPException(403, "target_permission_denied")
    scope = (
        "studio:private_read"
        if permission in {"content.read", "logs.read", "diagnostics.model", "docs.developer"}
        else "studio:write"
    )
    if not principal.permits(scope):
        raise HTTPException(403, "target_scope_denied")
    return issue_context(
        replace(actor, local=False),
        service=body.target_service,
        method=body.target_method,
        path=body.target_path,
        private_key=options["private_key"],
        key_id=options["key_id"],
    )


@router.post("/_internal/v1/authorization/delegate")
async def delegate(request: Request, body: DelegationRequest):
    credential = request.headers.get("authorization", "").removeprefix("Bearer ")
    token = await authorize_delegation(request.app.state, body, credential)
    from starlette.responses import JSONResponse

    return JSONResponse({"assertion": token}, headers={"Cache-Control": "no-store"})
