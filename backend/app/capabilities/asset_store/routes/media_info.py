from fastapi import APIRouter, HTTPException

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.media_info import get_video_media_info
from app.capabilities.asset_store.schemas.media_info import VideoMediaInfoOut
from app.deps import SessionDep, WorkspaceDep

router = APIRouter(tags=["file-management"])


@router.get("/files/{asset_id}/media-info", response_model=VideoMediaInfoOut)
async def video_media_info(asset_id: str, session: SessionDep, workspace_id: WorkspaceDep):
    try:
        return await get_video_media_info(session, workspace_id, asset_id)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
