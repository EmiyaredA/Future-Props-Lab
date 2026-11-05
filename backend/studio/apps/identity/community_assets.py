"""Mint and revalidate one short-lived, request-bound community asset grant."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from studio.contracts.identity.claims import verify_context
from studio.contracts.identity.route_permissions import route_permission
from studio.contracts.thought_workshop.community_assets import (
    CommunityAssetRequest,
    issue_community_asset,
    verify_community_asset,
)

from .integration_intents import require_client
from .live import active_actor

router = APIRouter(prefix="/_internal/v1/thought-community-assets", include_in_schema=False)


class GrantCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authority: str = Field(min_length=1, max_length=16384)


@router.post("/authorize")
async def authorize(request: Request, body: CommunityAssetRequest):
    require_client(request, "thought")
    options = request.app.state.identity_options
    if (
        not body.matches_source()
        or (
            operation := request.app.state.service_catalog.match(
                body.source_method, body.source_path
            )
        )
        is None
        or operation.service != "thought"
        or route_permission(body.source_method, body.source_path) != "community.access"
    ):
        raise HTTPException(403, "community_asset_source_forbidden")
    try:
        actor = verify_context(
            body.source_assertion,
            service="thought",
            method=body.source_method,
            path=body.source_path,
            public_key=options["private_key"].public_key(),
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "community_asset_source_required") from None
    if (
        actor.user_id != body.evidence.viewer_id
        or actor.auth_kind != "session"
        or actor.purpose != "studio"
        or "studio:read" not in actor.scopes
    ):
        raise HTTPException(403, "community_asset_source_forbidden")
    async with request.app.state.database.sessions() as session:
        if not await active_actor(session, actor):
            raise HTTPException(401, "community_asset_session_revoked")
    token = issue_community_asset(
        actor, body, private_key=options["private_key"], key_id=options["key_id"]
    )
    return JSONResponse({"authority": token}, headers={"Cache-Control": "no-store"})


@router.post("/check")
async def check(request: Request, body: GrantCheck):
    require_client(request, "assets")
    options = request.app.state.identity_options
    try:
        actor, source = verify_community_asset(
            body.authority, public_key=options["private_key"].public_key()
        )
        original = verify_context(
            source.source_assertion,
            service="thought",
            method=source.source_method,
            path=source.source_path,
            public_key=options["private_key"].public_key(),
        )
        if original != actor:
            raise ValueError("社区素材身份上下文已变化")
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "community_asset_authority_invalid") from None
    async with request.app.state.database.sessions() as session:
        active = await active_actor(session, actor)
    return JSONResponse({"active": active}, headers={"Cache-Control": "no-store"})
