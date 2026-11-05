"""Only the Creative peer can obtain an author's display name for a live request."""

import secrets

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from studio.apps.identity.storage.models.accounts import User
from studio.contracts.creative_workshop.creative_authors import (
    PATH,
    CreativeAuthorName,
    CreativeAuthorQuery,
    permits_author_query,
)
from studio.contracts.identity.claims import verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.identity.route_permissions import route_permission

from .live import active_actor

router = APIRouter(include_in_schema=False)


@router.post(PATH)
async def author(request: Request, body: CreativeAuthorQuery):
    options = request.app.state.identity_options
    credentials = options["service_credentials"]
    expected = credentials.get("creative")
    authorization = request.headers.get("authorization", "")
    if (
        request.headers.get("origin")
        or request.headers.get("cookie")
        or not isinstance(expected, str)
        or len(expected) < 32
        or not expected.isascii()
        or expected in {options["gateway_token"], options.get("management_gateway_token")}
        or any(
            secret == expected for service, secret in credentials.items() if service != "creative"
        )
        or not authorization.isascii()
        or not secrets.compare_digest(authorization, "Bearer " + expected)
    ):
        raise HTTPException(403, "creative_author_peer_required")
    if not permits_author_query(request.app.state.service_catalog, body):
        raise HTTPException(403, "creative_author_operation_forbidden")
    try:
        actor = verify_context(
            body.assertion,
            service="creative",
            method=body.source_method,
            path=body.source_path,
            public_key=options["private_key"].public_key(),
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "creative_author_assertion_required") from None
    permission = route_permission(body.source_method, body.source_path)
    if (
        actor.purpose != "studio"
        or permission not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
        or (body.source_method != "GET" and actor.user_id != body.author_id)
    ):
        raise HTTPException(403, "creative_author_operation_forbidden")
    async with request.app.state.database.sessions() as session:
        if not await active_actor(session, actor):
            raise HTTPException(401, "creative_author_authorization_revoked")
        profile = await session.get(User, body.author_id)
        name = (profile.display_name or profile.username) if profile else None
    return JSONResponse(
        CreativeAuthorName(name=name).model_dump(), headers={"Cache-Control": "no-store"}
    )
