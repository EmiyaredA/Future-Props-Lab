"""Compatible media HTTP operations; source access remains account- and request-bound."""

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import FileResponse

from studio.contracts.asset_library.files import FilePreviewOut
from studio.contracts.media_rendering.image_crop import ImageCropIn
from studio.contracts.media_rendering.media_info import VideoMediaInfoOut
from studio.contracts.media_rendering.video_frames import VideoFramesIn
from studio.runtime.files.image_sizes import ThumbnailSize
from studio.runtime.http.dependencies import OwnerDep
from studio.runtime.http.media_response import media_response

router = APIRouter(tags=["file-management"])


@router.get("/files/{asset_id}/preview", response_model=FilePreviewOut)
async def preview_file_metadata(asset_id: str, request: Request, owner_user_id: OwnerDep):
    return await request.app.state.media_reads(request).metadata(owner_user_id, asset_id)


@router.get(
    "/files/{asset_id}/thumbnail",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                mime: {"schema": {"type": "string", "format": "binary"}}
                for mime in ("image/webp", "image/svg+xml")
            }
        }
    },
)
async def preview_thumbnail(
    asset_id: str,
    request: Request,
    owner_user_id: OwnerDep,
    size: ThumbnailSize = 320,
    page: int = Query(default=1, ge=1),
) -> FileResponse:
    output = await request.app.state.media_reads(request).thumbnail(
        owner_user_id, asset_id, size, page
    )
    mime = output.media_type
    return media_response(
        output,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            **(
                {
                    "Content-Security-Policy": (
                        "default-src 'none'; style-src 'unsafe-inline'; sandbox"
                    )
                }
                if mime == "image/svg+xml"
                else {}
            ),
        },
    )


@router.get("/files/{asset_id}/media-info", response_model=VideoMediaInfoOut)
async def video_media_info(asset_id: str, request: Request, owner_user_id: OwnerDep):
    return await request.app.state.media_reads(request).video_info(owner_user_id, asset_id)


@router.post(
    "/files/{asset_id}/crop",
    response_class=Response,
    responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def crop_file_image(
    asset_id: str,
    body: ImageCropIn,
    request: Request,
    owner_user_id: OwnerDep,
):
    content = await request.app.state.media_reads(request).crop(owner_user_id, asset_id, body)
    return Response(
        content,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="crop.png"'},
    )


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
    asset_id: str,
    body: VideoFramesIn,
    request: Request,
    owner_user_id: OwnerDep,
):
    output = await request.app.state.media_reads(request).frames(owner_user_id, asset_id, body)
    return media_response(output, download=True)
