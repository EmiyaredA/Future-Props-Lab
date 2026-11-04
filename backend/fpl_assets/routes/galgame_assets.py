"""Read an authenticated, digest-matched Galgame Assets projection."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.capabilities.asset_store.policy import download_filename
from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.galgame_annotation_source import AUDIO_PATH, AudioDigest, audio_target
from fpl_runtime.galgame_assets import (
    PREFIX,
    GalgameAssetFile,
    GalgameAssetQuery,
    asset_query_target,
    export_download_target,
)

from ..galgame_audio_digest import read_digest
from ..galgame_files import export_file, files

router = APIRouter(include_in_schema=False)


async def verified_actor(request):
    path = request.url.path
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_galgame_file_query_required")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token,
            service="assets",
            method=request.method,
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "galgame_file_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_file_authorization_forbidden")
    active = await state.identity.status(assertion=token, method=request.method, path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_file_authority_ended")
    return actor


@router.post(PREFIX + "/{project_id}/{digest}", response_model=list[GalgameAssetFile])
@router.post(
    PREFIX + "/{project_id}/one/{asset_id}/{digest}", response_model=list[GalgameAssetFile]
)
@router.post(
    PREFIX + "/{project_id}/replacement/{asset_id}/{digest}", response_model=list[GalgameAssetFile]
)
@router.post(PREFIX + "/{project_id}/scan/{digest}", response_model=list[GalgameAssetFile])
async def read_galgame_files(
    request: Request, project_id: str, digest: str, body: GalgameAssetQuery
):
    path = request.url.path
    scope = asset_query_target("POST", path)
    if (
        scope is None
        or scope["asset"] != body.project_file_id
        or bool(scope["scan"]) != body.scan
        or (scope["mode"] == "replacement") != body.replacement
        or "cookie" in request.headers
        or "origin" in request.headers
        or body.digest != digest
    ):
        raise HTTPException(403, "private_galgame_file_query_required")
    state = request.app.state
    actor = await verified_actor(request)
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        return await files(session, state.settings, project_id, body)


@router.get(PREFIX + "/{project_id}/exports/{export_id}/files/{asset_id}")
async def download_galgame_export(request: Request, project_id: str, asset_id: str):
    if export_download_target("GET", request.url.path) is None:
        raise HTTPException(404, "galgame_export_not_found")
    actor = await verified_actor(request)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        asset, path = await export_file(session, state.settings, project_id, asset_id)
    return FileResponse(
        path,
        media_type=asset.mime_type,
        filename=download_filename(asset.display_name, asset.original_filename),
        headers={"Cache-Control": "private, no-store"},
    )


@router.get(AUDIO_PATH + "/{project_id}/{annotation_id}/{asset_id}", response_model=AudioDigest)
async def annotation_audio_digest(request: Request, asset_id: str):
    if not audio_target("GET", request.url.path):
        raise HTTPException(403, "galgame_annotation_audio_grant_required")
    actor = await verified_actor(request)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        return await read_digest(session, state.settings, asset_id)
