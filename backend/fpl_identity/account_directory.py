"""Thought can request only public account names using a currently authorized source request."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select

from app.capabilities.identity.permissions import effective_permissions
from app.console.models.accounts import User
from fpl_runtime.account_directory import (
    AccountProfile,
    CallerProfile,
    DirectoryQuery,
    DirectoryResult,
)
from fpl_runtime.claims import HEADER, verify_context

from .live import active_actor

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
        caller = await session.get(User, actor.user_id)
        rows = list(
            await session.scalars(
                select(User).where(
                    or_(User.id.in_(body.ids), User.username_normalized.in_(body.usernames))
                )
            )
        )
        result = DirectoryResult(
            caller=CallerProfile(
                id=caller.id,
                username=caller.username,
                display_name=caller.display_name,
                active=True,
                platform_role=caller.platform_role,
                revision=caller.revision,
            ),
            profiles=[
                AccountProfile(
                    id=user.id,
                    username=user.username,
                    display_name=user.display_name,
                    active=user.status == "active",
                )
                for user in rows
            ],
        )
    return JSONResponse(result.model_dump(), headers={"Cache-Control": "no-store"})
