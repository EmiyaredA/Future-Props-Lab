from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.apps.presentation_workshop.exchange.contracts import ExportPreview, ImportPreview
from app.apps.presentation_workshop.exchange.transfers import (
    export_document,
    export_preview,
    import_presentation,
    parse_upload,
    preview,
)
from app.apps.presentation_workshop.projects import PresentationError, Presentations
from app.apps.presentation_workshop.schemas.document import (
    PresentationExportIn,
    PresentationProjectOut,
)
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


@router.post("/projects/{project_id}/export/preview", response_model=ExportPreview)
async def preview_export(
    project_id: str, body: PresentationExportIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await mapped(
        export_preview(Presentations(session, owner_user_id), project_id, body.expected_revision)
    )


@router.post(
    "/projects/{project_id}/export/{format}",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/json": {"schema": {"type": "string", "format": "binary"}},
                "application/zip": {"schema": {"type": "string", "format": "binary"}},
            }
        }
    },
)
async def export_file(
    project_id: str,
    format: Literal["json", "fplppt"],
    body: PresentationExportIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    content = await mapped(
        export_document(
            Presentations(session, owner_user_id), project_id, body.expected_revision, format
        )
    )
    return Response(
        content,
        media_type="application/json" if format == "json" else "application/zip",
        headers={"Content-Disposition": f'attachment; filename="presentation.{format}"'},
    )
