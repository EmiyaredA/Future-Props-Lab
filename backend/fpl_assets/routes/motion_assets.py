"""Private metadata scoped to the authenticated account's exact Motion project."""

from typing import Annotated

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.motion_assets import MAX_IDS, PREFIX, MotionAssetQuery

from ..motion_files import describe

router = APIRouter(include_in_schema=False)


def owner_for(request):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_motion_assets_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_assets_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "motion_assets_authorization_forbidden")
    return actor.user_id


@router.get(PREFIX + "/{project_id}/{digest}")
async def metadata(
    request: Request,
    project_id: str,
    digest: str,
    id: Annotated[list[str], Query(max_length=MAX_IDS)],
):
    owner = owner_for(request)
    try:
        query = MotionAssetQuery(asset_ids=id)
        if query.digest != digest:
            raise HTTPException(403, "motion_asset_query_changed")
    except (ValidationError, ValueError):
        raise HTTPException(422, "motion_asset_query_invalid") from None
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        items = await describe(session, owner, project_id, query.asset_ids)
    return {"items": items}
