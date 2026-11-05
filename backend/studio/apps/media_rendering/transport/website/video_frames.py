from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from studio.assembly.http_dependencies import OwnerDep
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.media_rendering.video_frames import VideoFramesIn
from studio.runtime.http.media_response import media_response

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
    asset_id: str, body: VideoFramesIn, request: Request, owner_user_id: OwnerDep
):
    try:
        output = await request.app.state.media_reads(request).frames(owner_user_id, asset_id, body)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return media_response(output, download=True)
