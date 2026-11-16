"""Thought can request only public account names using a currently authorized source request."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from studio.apps.identity.storage.account_directory import lookup as directory_lookup
from studio.apps.identity.storage.actor_status import active_actor
from studio.contracts.identity.account_directory import (
    DirectoryQuery,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions

router = APIRouter(include_in_schema=False)


@router.post("/_internal/v1/thought-account-directory/{digest}")
async def lookup(request: Request, digest: str, body: DirectoryQuery):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "private_account_directory_required")
    if body.digest != digest:
        raise HTTPException(422, "account_directory_query_changed")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="identity",
            method="POST",
            path=request.url.path,
            public_key=request.app.state.identity_options["private_key"].public_key(),
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "account_directory_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "account_directory_forbidden")
    async with request.app.state.database.sessions() as session:
        if not await active_actor(session, actor):
            raise HTTPException(401, "account_directory_authorization_revoked")
        result = await directory_lookup(session, actor, body)
    return JSONResponse(result.model_dump(), headers={"Cache-Control": "no-store"})
