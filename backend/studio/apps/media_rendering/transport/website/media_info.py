from fastapi import APIRouter, HTTPException, Request

from studio.assembly.http_dependencies import OwnerDep
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.media_rendering.media_info import VideoMediaInfoOut

router = APIRouter(tags=["file-management"])


@router.get("/files/{asset_id}/media-info", response_model=VideoMediaInfoOut)
async def video_media_info(asset_id: str, request: Request, owner_user_id: OwnerDep):
    try:
        return await request.app.state.media_reads(request).video_info(owner_user_id, asset_id)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
