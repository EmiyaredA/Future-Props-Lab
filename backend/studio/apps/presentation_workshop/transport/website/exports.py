"""Published preview and download adapters for Presentation exports."""

from typing import Literal

from fastapi import APIRouter
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from studio.apps.presentation_workshop.exchange.contracts import ExportPreview
from studio.apps.presentation_workshop.exchange.export_formats import (
    export_document,
    export_preview,
)
from studio.apps.presentation_workshop.exports import export_project
from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.schemas.document import PresentationExportIn
from studio.apps.presentation_workshop.transport.website.dependencies import PresentationDep
from studio.apps.presentation_workshop.transport.website.projects import mapped

router = APIRouter()


async def mapped_export(work):
    try:
        return await work
    except PresentationError as exc:
        raise mapped(exc) from None


@router.post(
    "/projects/{project_id}/export",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        }
    },
)
async def export_pptx(projects: PresentationDep, project_id: str, body: PresentationExportIn):
    try:
        result = await export_project(
            projects,
            project_id,
            body.expected_revision,
        )
    except PresentationError as exc:
        raise mapped(exc) from None
    return FileResponse(
        result.path,
        filename=result.filename,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        background=BackgroundTask(result.cleanup),
    )


@router.post("/projects/{project_id}/export/preview", response_model=ExportPreview)
async def preview_export(project_id: str, body: PresentationExportIn, projects: PresentationDep):
    return await mapped_export(export_preview(projects, project_id, body.expected_revision))


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
    projects: PresentationDep,
):
    content = await mapped_export(
        export_document(projects, project_id, body.expected_revision, format)
    )
    return Response(
        content,
        media_type="application/json" if format == "json" else "application/zip",
        headers={"Content-Disposition": f'attachment; filename="presentation.{format}"'},
    )
