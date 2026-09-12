from fastapi import APIRouter, HTTPException, Response

from app.deps import SessionDep, WorkspaceDep
from app.files.image_crop import crop_image
from app.files.library import AssetError
from app.schemas.image_crop import ImageCropIn

router = APIRouter(tags=["file-management"])


@router.post(
    "/files/{asset_id}/crop",
    response_class=Response,
    responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def crop_file_image(
    asset_id: str,
    body: ImageCropIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    try:
        content = await crop_image(session, workspace_id, asset_id, body)
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return Response(
        content,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="crop.png"'},
    )
