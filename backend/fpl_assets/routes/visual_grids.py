"""Provide exact Visual project images to the authorized grid renderer."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.framed_media import content_length, stream_files
from fpl_runtime.visual_composition import (
    ASSETS,
    MAX_BYTES,
    GridAsset,
    GridAssetQuery,
    GridFileScope,
    grid_asset_target,
)

from ..visual_grid_files import grid_files
from ..visual_snapshot_files import originals

router = APIRouter(include_in_schema=False)


async def authorize(request, digest, expected):
    path, state = request.url.path, request.app.state
    if (
        not grid_asset_target("POST", path)
        or "origin" in request.headers
        or "cookie" in request.headers
        or digest != expected
    ):
        raise HTTPException(403, "visual_grid_grant_required")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_grid_grant_required") from None
    if actor.purpose != "studio" or not {"content.write", "models.use"} & effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_grid_assets_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_grid_authority_ended")
    return actor.user_id


@router.post(ASSETS + "/{project_id}/{batch_id}/metadata/{digest}", response_model=list[GridAsset])
async def grid_metadata(
    request: Request, project_id: str, batch_id: str, digest: str, body: GridAssetQuery
):
    owner = await authorize(
        request,
        digest,
        body.digest if request.url.path == body.path(project_id, batch_id) else None,
    )
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        return await grid_files(session, state.settings, project_id, body.asset_ids)


@router.post(ASSETS + "/{project_id}/{batch_id}/originals/{digest}")
async def grid_originals(
    request: Request, project_id: str, batch_id: str, digest: str, body: GridFileScope
):
    owner = await authorize(
        request,
        digest,
        body.digest if request.url.path == body.path(project_id, batch_id) else None,
    )
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        files = await originals(session, state.settings, project_id, body.files, media_kind="image")
    if sum(size for _, size in files) > MAX_BYTES:
        raise AssetError("宫格原件超过大小限制", code="visual_grid_too_large", status=413)
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(content_length(files)),
            "Cache-Control": "private, no-store",
        },
    )
