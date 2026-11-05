"""Provide the exact project video for one authenticated Visual review sample."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.framed_media import content_length, stream_files
from fpl_runtime.library_assets import LibraryAssetDescription
from fpl_runtime.visual_samples import ASSETS, SampleAssetQuery, SampleFileScope, asset_target

from ..scoped_project_files import check_project_scope
from ..visual_snapshot_files import originals, scoped_assets

router = APIRouter(include_in_schema=False)


async def owner_for(request, expected):
    path, state = request.url.path, request.app.state
    if (
        path != expected
        or not asset_target("POST", path)
        or "cookie" in request.headers
        or "origin" in request.headers
    ):
        raise HTTPException(403, "visual_sample_asset_scope_changed")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_sample_asset_grant_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_sample_asset_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_sample_authority_ended")
    return actor.user_id


@router.post(
    ASSETS + "/{project_id}/{run_id}/metadata/{digest}", response_model=LibraryAssetDescription
)
async def visual_sample_asset(
    request: Request, project_id: str, run_id: str, body: SampleAssetQuery
):
    owner = await owner_for(request, body.path(project_id, run_id))
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        await check_project_scope(session, "visual", project_id)
        rows = await scoped_assets(session, project_id, body.asset_ids, include_private=False)
        if len(rows) != 1 or rows[0][0].media_kind != "video":
            raise AssetError("验收源视频不存在", code="not_found", status=404)
        return LibraryAssetDescription.model_validate(rows[0][0], from_attributes=True)


@router.post(ASSETS + "/{project_id}/{run_id}/original/{digest}")
async def visual_sample_original(
    request: Request, project_id: str, run_id: str, body: SampleFileScope
):
    owner = await owner_for(request, body.path(project_id, run_id))
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        files = await originals(session, state.settings, project_id, body.files, media_kind="video")
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(content_length(files)),
            "Cache-Control": "private, no-store",
        },
    )
