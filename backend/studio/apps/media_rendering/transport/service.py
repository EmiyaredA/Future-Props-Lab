"""Compatible media HTTP operations; source access remains account- and request-bound."""

import shutil

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.capabilities.asset_store.schemas.files import FilePreviewOut
from app.capabilities.asset_store.schemas.image_crop import ImageCropIn
from app.capabilities.asset_store.schemas.media_info import VideoMediaInfoOut
from app.capabilities.asset_store.schemas.video_frames import VideoFramesIn
from app.runtime.image_sizes import ThumbnailSize
from studio.apps.media_rendering.inputs import input_file
from studio.runtime.http.dependencies import OwnerDep

router = APIRouter(tags=["file-management"])


async def execute(request, owner, asset_id, operation, *arguments):
    state = request.app.state
    output = None
    try:
        async with state.media.capacity:
            async with input_file(
                settings=state.settings,
                capabilities=state.capabilities,
                owner=owner,
                assertion=request.state.service_assertion,
                method=request.method,
                path=request.url.path,
                asset_id=asset_id,
            ) as (info, source):
                output = await getattr(state.media, operation)(info, source, *arguments)
        active = await state.identity.status(
            assertion=request.state.service_assertion,
            method=request.method,
            path=request.url.path,
        )
        if active is None:
            raise HTTPException(503, {"code": "identity_unavailable"})
        if not active:
            raise HTTPException(401, {"code": "source_authorization_revoked"})
        return output
    except BaseException:
        if operation == "frames" and output is not None:
            shutil.rmtree(output.parent, ignore_errors=True)
        raise


@router.get("/files/{asset_id}/preview", response_model=FilePreviewOut)
async def preview_file_metadata(asset_id: str, request: Request, owner_user_id: OwnerDep):
    return await execute(request, owner_user_id, asset_id, "metadata")


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
    path, mime = await execute(request, owner_user_id, asset_id, "thumbnail", size, page)
    return FileResponse(
        path,
        media_type=mime,
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
    return await execute(request, owner_user_id, asset_id, "video_info")


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
    content = await execute(request, owner_user_id, asset_id, "crop", body)
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
    path = await execute(request, owner_user_id, asset_id, "frames", body)
    return FileResponse(
        path,
        filename=path.name,
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )
