from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from studio.apps.presentation_workshop.exchange.contracts import ImportPreview
from studio.apps.presentation_workshop.exchange.transfers import (
    import_presentation,
    parse_upload,
    preview,
)
from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.schemas.document import PresentationProjectOut
from studio.apps.presentation_workshop.transport.website.dependencies import PresentationDep
from studio.contracts.asset_library.errors import AssetError

router = APIRouter()


async def mapped(work):
    try:
        return await work
    except (PresentationError, AssetError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/imports/preview", response_model=ImportPreview)
async def preview_import(projects: PresentationDep, upload: UploadFile = File()):
    parsed = await mapped(parse_upload(upload))
    if not parsed.assets:
        await mapped(projects.assets(parsed.document))
    return preview(parsed)


@router.post("/imports", response_model=PresentationProjectOut)
async def create_import(
    request: Request,
    projects: PresentationDep,
    upload: UploadFile = File(),
    allow_lossy: bool = Form(False),
):
    parsed = await mapped(parse_upload(upload))
    return await mapped(
        import_presentation(
            projects, parsed, allow_lossy, run=request.app.state.presentation_importer(request)
        )
    )
