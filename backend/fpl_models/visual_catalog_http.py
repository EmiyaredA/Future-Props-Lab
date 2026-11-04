"""Serve Visual's account-scoped catalog lookups without transferring credentials."""

from contextlib import asynccontextmanager

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from app.llm.schemas.visual_catalog import AcceptanceModelListOut, GenerationOptionsOut
from app.llm.visual_catalog import acceptance_models, generation_options
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_catalog import ACCEPTANCE_TARGET, GENERATION_TARGET

router = APIRouter(include_in_schema=False)


@asynccontextmanager
async def owned_catalog(request):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "visual_catalog_grant_required")
    token = request.headers.get(HEADER, "")
    path = request.url.path
    try:
        actor = verify_context(
            token,
            service="models",
            method="GET",
            path=path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_catalog_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_catalog_access_forbidden")
    active = await request.app.state.identity.status(assertion=token, method="GET", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_catalog_authority_unavailable")
    async with request.app.state.database.sessions(
        info={"owner_user_id": actor.user_id}
    ) as session:
        yield actor, session


@router.get(GENERATION_TARGET, response_model=GenerationOptionsOut)
async def read_generation_options(request: Request):
    async with owned_catalog(request) as (_actor, session):
        return await generation_options(
            session, upload_configured=bool(request.app.state.settings.fpl_temp_media_upload_url)
        )


@router.get(ACCEPTANCE_TARGET, response_model=AcceptanceModelListOut)
async def read_acceptance_models(request: Request):
    async with owned_catalog(request) as (actor, session):
        return await acceptance_models(session, actor.user_id)
