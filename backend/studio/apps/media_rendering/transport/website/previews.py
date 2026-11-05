"""Website preview transport; source authorization and processing are injected."""

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse

from studio.assembly.http_dependencies import OwnerDep
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.files import FilePreviewOut
from studio.runtime.files.image_sizes import ThumbnailSize
from studio.runtime.http.media_response import media_response

router = APIRouter(tags=["file-management"])


def asset_http_error(exc):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/files/{asset_id}/preview", response_model=FilePreviewOut)
async def preview_file_metadata(
    request: Request, owner_user_id: OwnerDep, asset_id: str, response: Response
) -> FilePreviewOut:
    try:
        result = await request.app.state.media_reads(request).metadata(owner_user_id, asset_id)
    except AssetError as exc:
        raise asset_http_error(exc) from None
    response.headers["Cache-Control"] = "private, no-store"
    return result


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
    request: Request,
    owner_user_id: OwnerDep,
    asset_id: str,
    size: ThumbnailSize = 320,
    page: int = Query(default=1, ge=1),
) -> FileResponse:
    try:
        output = await request.app.state.media_reads(request).thumbnail(
            owner_user_id, asset_id, size, page
        )
    except AssetError as exc:
        raise asset_http_error(exc) from None
    return media_response(
        output,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
    )
