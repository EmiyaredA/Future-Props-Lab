"""Read an authenticated, digest-matched Galgame Assets projection."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.galgame_assets import (
    PREFIX,
    GalgameAssetFile,
    GalgameAssetQuery,
    asset_query_target,
)

from ..galgame_files import files

router = APIRouter(include_in_schema=False)


@router.post(PREFIX + "/{project_id}/{digest}", response_model=list[GalgameAssetFile])
@router.post(
    PREFIX + "/{project_id}/one/{asset_id}/{digest}", response_model=list[GalgameAssetFile]
)
async def read_galgame_files(
    request: Request, project_id: str, digest: str, body: GalgameAssetQuery
):
    path = request.url.path
    scope = asset_query_target("POST", path)
    if (
        scope is None
        or scope["asset"] != body.project_file_id
        or "cookie" in request.headers
        or "origin" in request.headers
        or body.digest != digest
    ):
        raise HTTPException(403, "private_galgame_file_query_required")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "galgame_file_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_file_authorization_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_file_authority_ended")
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        return await files(session, state.settings, project_id, body)
