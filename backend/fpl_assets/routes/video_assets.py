"""Handle the Video Editor's signed exact metadata request."""

from typing import Annotated

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.video_assets import MAX_IDS, PREFIX, VideoAssetQuery

from ..video_files import describe

router = APIRouter(include_in_schema=False)


@router.get(PREFIX + "/{project_id}/metadata/{digest}")
async def metadata(
    request: Request,
    project_id: str,
    digest: str,
    id: Annotated[list[str], Query(max_length=MAX_IDS)],
):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_video_assets_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method="GET",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "video_assets_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "video_assets_authorization_forbidden")
    try:
        query = VideoAssetQuery(asset_ids=id)
        if query.digest != digest or query.path(project_id) != request.url.path:
            raise HTTPException(403, "video_asset_query_changed")
    except (ValidationError, ValueError):
        raise HTTPException(422, "video_asset_query_invalid") from None
    owner = actor.user_id
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await describe(session, owner, project_id, query.asset_ids)}
