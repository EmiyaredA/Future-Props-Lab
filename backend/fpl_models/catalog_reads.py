"""Verify account authority for private credential-free catalog reads."""

from contextlib import asynccontextmanager

import jwt
from fastapi import HTTPException

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context


@asynccontextmanager
async def owned_catalog(request, *, purpose):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, f"{purpose}_grant_required")
    token = request.headers.get(HEADER, "")
    path = request.url.path
    try:
        actor = verify_context(
            token,
            service="models",
            method=request.method,
            path=path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, f"{purpose}_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, f"{purpose}_access_forbidden")
    active = await request.app.state.identity.status(
        assertion=token, method=request.method, path=path
    )
    if active is not True:
        raise HTTPException(401 if active is False else 503, f"{purpose}_authority_unavailable")
    async with request.app.state.database.sessions(
        info={"owner_user_id": actor.user_id}
    ) as session:
        yield actor, session
