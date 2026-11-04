"""Return only the project files in a signed Motion archive export scope."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from fpl_runtime.framed_media import content_length, stream_files
from fpl_runtime.motion_assets import PREFIX
from fpl_runtime.motion_snapshot import MAX_SCOPE_BYTES, SnapshotScope

from ..motion_files import snapshot_metadata, versioned_files
from .motion_assets import owner_for

router = APIRouter(include_in_schema=False)


@router.get(PREFIX + "/{project_id}/snapshot-metadata")
async def metadata(request: Request, project_id: str):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await snapshot_metadata(session, owner, project_id)}


@router.post(PREFIX + "/{project_id}/snapshot/{digest}")
async def snapshot_files(request: Request, project_id: str, digest: str):
    owner = owner_for(request)
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
        files = await versioned_files(session, state.settings, owner, project_id, scope.files)
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={"Content-Length": str(content_length(files))},
    )
