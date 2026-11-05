"""Serve exact, authorized acceptance metadata without exposing originals."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.asset_library.visual.visual_acceptance_files import read_context_assets
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.visual_workshop.visual_acceptance_assets import (
    PREFIX,
    AcceptanceAsset,
    AcceptanceAssetQuery,
    acceptance_asset_target,
)

router = APIRouter(include_in_schema=False)


@router.post(PREFIX + "/{project_id}/{digest}", response_model=list[AcceptanceAsset])
async def acceptance_assets(
    request: Request, project_id: str, digest: str, body: AcceptanceAssetQuery
):
    path = request.url.path
    if (
        acceptance_asset_target("POST", path) is None
        or "cookie" in request.headers
        or "origin" in request.headers
        or body.digest != digest
    ):
        raise HTTPException(403, "visual_acceptance_assets_grant_required")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "visual_acceptance_assets_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_acceptance_assets_access_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(
            401 if active is False else 503, "visual_acceptance_assets_authority_ended"
        )
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        return await read_context_assets(session, state.settings, project_id, body.asset_ids)
