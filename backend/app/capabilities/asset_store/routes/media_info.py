from fastapi import APIRouter, HTTPException

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.media_info import get_video_media_info
from app.capabilities.asset_store.schemas.media_info import VideoMediaInfoOut
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(tags=["file-management"])


@router.get("/files/{asset_id}/media-info", response_model=VideoMediaInfoOut)
async def video_media_info(asset_id: str, session: SessionDep, owner_user_id: OwnerDep):
    try:
        return await get_video_media_info(session, owner_user_id, asset_id)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
