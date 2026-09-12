import shutil

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.deps import SessionDep, WorkspaceDep
from app.files.library import AssetError
from app.files.video_frames import export_frames
from app.schemas.video_frames import VideoFramesIn

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
    asset_id: str, body: VideoFramesIn, session: SessionDep, workspace_id: WorkspaceDep
):
    try:
        path = await export_frames(session, workspace_id, asset_id, body)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return FileResponse(
        path,
        filename=path.name,
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )
