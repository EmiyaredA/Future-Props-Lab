"""Expose a signed, exact Video project original to the media processor."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.video_processing import ORIGINALS, MediaOriginal, valid_id

from ..video_files import original_record

router = APIRouter(include_in_schema=False)


@router.get(ORIGINALS + "/{project_id}/{asset_id}")
async def original(request: Request, project_id: str, asset_id: str):
    state = request.app.state
    peer = state.video_originals_peer
    if (
        peer is None
        or not valid_id(project_id)
        or not valid_id(asset_id)
        or "origin" in request.headers
        or "cookie" in request.headers
    ):
        raise HTTPException(403, "video_original_peer_required")
    try:
        owner = peer.owner("GET", request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "video_original_peer_required") from None
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        row = await original_record(session, owner, project_id, asset_id)
        if row is None:
            raise HTTPException(404, "video_original_not_found")
        path = AssetStorage(state.settings).path_for(row)
        source = MediaOriginal(kind=row.media_kind, byte_size=row.byte_size)
    if path.is_symlink() or not path.is_file() or path.stat().st_size != source.byte_size:
        raise HTTPException(409, "video_original_changed")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store", "X-Fpl-Media-Kind": source.kind},
    )
