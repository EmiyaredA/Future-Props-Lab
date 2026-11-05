from fastapi import APIRouter, HTTPException, Request, Response

from studio.assembly.http_dependencies import OwnerDep
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.media_rendering.image_crop import ImageCropIn

router = APIRouter(tags=["file-management"])


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
    try:
        content = await request.app.state.media_reads(request).crop(owner_user_id, asset_id, body)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return Response(
        content,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="crop.png"'},
    )
