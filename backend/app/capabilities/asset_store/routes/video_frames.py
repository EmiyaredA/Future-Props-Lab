import shutil

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.schemas.video_frames import VideoFramesIn
from app.capabilities.asset_store.video_frames import export_frames
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(tags=["file-management"])


@router.post(
    "/files/{asset_id}/frames",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def extract_video_frames(
    asset_id: str, body: VideoFramesIn, session: SessionDep, owner_user_id: OwnerDep
):
    try:
        path = await export_frames(session, owner_user_id, asset_id, body)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return FileResponse(
        path,
        filename=path.name,
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )
