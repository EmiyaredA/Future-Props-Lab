from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.apps.presentation_workshop.exchange.contracts import ImportPreview
from app.apps.presentation_workshop.exchange.transfers import (
    import_presentation,
    parse_upload,
    preview,
)
from app.apps.presentation_workshop.projects import PresentationError, Presentations
from app.apps.presentation_workshop.schemas.document import PresentationProjectOut
from app.capabilities.asset_store.library import AssetError
from app.deps import OwnerDep, SessionDep

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
