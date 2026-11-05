"""Read an authenticated, digest-matched Galgame Assets projection."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from studio.apps.asset_library.galgame.galgame_audio_digest import (
    audio_original,
    digest_original,
    read_digest,
)
from studio.apps.asset_library.galgame.galgame_files import (
    asr_original,
    export_file,
    files,
    snapshot_originals,
)
from studio.contracts.galgame_workshop.galgame_annotation_source import (
    AUDIO_PATH,
    AudioDigest,
    audio_target,
)
from studio.contracts.galgame_workshop.galgame_asr_execution import (
    ORIGINAL,
    ORIGINAL_HEADER,
    original_target,
)
from studio.contracts.galgame_workshop.galgame_assets import (
    PREFIX,
    GalgameAssetFile,
    GalgameAssetQuery,
    asset_query_target,
    export_download_target,
)
from studio.contracts.galgame_workshop.galgame_exports import INPUTS as EXPORT_INPUTS
from studio.contracts.galgame_workshop.galgame_exports import inputs_target as export_inputs_target
from studio.contracts.galgame_workshop.galgame_frames import INPUTS as FRAME_INPUTS
from studio.contracts.galgame_workshop.galgame_frames import inputs_target as frame_inputs_target
from studio.contracts.galgame_workshop.galgame_handoff import HANDOFF_INPUTS
from studio.contracts.galgame_workshop.galgame_snapshot import snapshot_files_target
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_snapshot import MAX_SCOPE_BYTES, SnapshotScope
from studio.runtime.files.names import download_filename
from studio.runtime.http.framed_media import content_length, stream_files

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
            allow_expired=bool(export_inputs_target(request.method, path)),
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


@router.get(AUDIO_PATH + "/{project_id}/{annotation_id}/{asset_id}/original/{sha256}")
async def annotation_audio_original(request: Request, asset_id: str):
    scope = audio_target("GET", request.url.path)
    if not scope or not scope["sha256"]:
        raise HTTPException(403, "galgame_annotation_audio_grant_required")
    actor = await verified_actor(request)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        path = await audio_original(session, state.settings, asset_id)
    if (await digest_original(path)).sha256 != scope["sha256"]:
        raise HTTPException(409, "galgame_annotation_source_changed")
    return FileResponse(
        path, media_type="application/octet-stream", headers={"Cache-Control": "private, no-store"}
    )


@router.post(PREFIX + "/{project_id}/snapshot/{digest}")
@router.post(FRAME_INPUTS + "/{project_id}/{digest}")
@router.post(EXPORT_INPUTS + "/{project_id}/{job_id}/{digest}")
@router.post(HANDOFF_INPUTS + "/{project_id}/{job_id}/{digest}")
async def galgame_snapshot_originals(request: Request, project_id: str, digest: str):
    path = request.url.path
    if not (
        snapshot_files_target("POST", path)
        or frame_inputs_target("POST", path)
        or export_inputs_target("POST", path)
    ):
        raise HTTPException(403, "galgame_snapshot_grant_required")
    actor = await verified_actor(request)
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_SCOPE_BYTES:
            raise HTTPException(413, "galgame_snapshot_scope_too_large")
        raw.extend(chunk)
    try:
        scope = SnapshotScope.model_validate_json(bytes(raw))
    except ValidationError:
        raise HTTPException(422, "galgame_snapshot_scope_invalid") from None
    if scope.digest != digest:
        raise HTTPException(403, "galgame_snapshot_scope_mismatch")
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        originals = await snapshot_originals(session, state.settings, project_id, scope.files)
    return StreamingResponse(
        stream_files(originals),
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Length": str(content_length(originals)),
        },
    )


@router.get(ORIGINAL + "/{project_id}/{asset_id}/{revision}")
async def galgame_asr_original(request: Request, project_id: str, asset_id: str, revision: int):
    if not original_target("GET", request.url.path):
        raise HTTPException(403, "galgame_asr_original_grant_required")
    actor = await verified_actor(request)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        path, description = await asr_original(
            session, state.settings, project_id, asset_id, revision
        )
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, no-store", ORIGINAL_HEADER: description.header()},
    )
