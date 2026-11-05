from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from studio.apps.presentation_workshop.exchange.contracts import ImportPreview
from studio.apps.presentation_workshop.exchange.transfers import (
    import_presentation,
    parse_upload,
    preview,
)
from studio.apps.presentation_workshop.projects import PresentationError, Presentations
from studio.apps.presentation_workshop.schemas.document import PresentationProjectOut
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.contracts.asset_library.errors import AssetError

router = APIRouter()


async def mapped(work):
    try:
        return await work
    except (PresentationError, AssetError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/imports/preview", response_model=ImportPreview)
async def preview_import(session: SessionDep, owner_user_id: OwnerDep, upload: UploadFile = File()):
    parsed = await mapped(parse_upload(upload))
    if not parsed.assets:
        await mapped(Presentations(session, owner_user_id).assets(parsed.document))
    return preview(parsed)


@router.post("/imports", response_model=PresentationProjectOut)
async def create_import(
    session: SessionDep,
    owner_user_id: OwnerDep,
    upload: UploadFile = File(),
    allow_lossy: bool = Form(False),
):
    parsed = await mapped(parse_upload(upload))
    return await mapped(
        import_presentation(Presentations(session, owner_user_id), parsed, allow_lossy)
    )
