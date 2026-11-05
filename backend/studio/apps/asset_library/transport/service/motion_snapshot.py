"""Return only the project files in a signed Motion archive export scope."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from studio.apps.asset_library.motion.motion_files import snapshot_metadata, versioned_files
from studio.apps.asset_library.transport.service.motion_assets import owner_for
from studio.apps.asset_library.transport.service.video_assets import owner_for as video_owner
from studio.apps.asset_library.video.video_files import versioned_files as video_files
from studio.contracts.motion_compositor.motion_assets import PREFIX
from studio.contracts.motion_compositor.motion_snapshot import MAX_SCOPE_BYTES, SnapshotScope
from studio.contracts.video_editor.video_assets import PREFIX as VIDEO_PREFIX
from studio.runtime.http.framed_media import content_length, stream_files

router = APIRouter(include_in_schema=False)


@router.get(PREFIX + "/{project_id}/snapshot-metadata")
async def metadata(request: Request, project_id: str):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await snapshot_metadata(session, owner, project_id)}


@router.post(VIDEO_PREFIX + "/{project_id}/snapshot/{digest}")
@router.post(PREFIX + "/{project_id}/snapshot/{digest}")
async def snapshot_files(request: Request, project_id: str, digest: str):
    video = request.url.path.startswith(VIDEO_PREFIX + "/")
    owner = video_owner(request, method="POST") if video else owner_for(request)
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_SCOPE_BYTES:
            raise HTTPException(413, "motion_snapshot_scope_too_large")
        raw.extend(chunk)
    try:
        scope = SnapshotScope.model_validate_json(bytes(raw))
    except ValidationError:
        raise HTTPException(422, "motion_snapshot_scope_invalid") from None
    if scope.digest != digest:
        raise HTTPException(403, "motion_snapshot_scope_mismatch")
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        load = video_files if video else versioned_files
        files = await load(session, state.settings, owner, project_id, scope.files)
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={"Content-Length": str(content_length(files))},
    )
