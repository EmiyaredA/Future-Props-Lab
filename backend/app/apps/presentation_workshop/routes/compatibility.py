from fastapi import APIRouter
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.apps.presentation_workshop.exports import export_project
from app.apps.presentation_workshop.projects import PresentationError, Presentations
from app.apps.presentation_workshop.routes.exchange import router as exchange_router
from app.apps.presentation_workshop.routes.projects import mapped
from app.apps.presentation_workshop.routes.projects import router as projects_router
from app.apps.presentation_workshop.routes.templates import router as templates_router
from app.apps.presentation_workshop.schemas.document import (
    PresentationExportIn,
)
from app.capabilities.asset_store import AssetStorage
from app.deps import OwnerDep, SessionDep
from app.runtime.config import get_settings

router = APIRouter(prefix="/presentation-workshop", tags=["presentation-workshop"])
router.include_router(exchange_router)

router.include_router(templates_router)
router.include_router(projects_router)


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
async def export_pptx(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: PresentationExportIn
):
    try:
        result = await export_project(
            Presentations(session, owner_user_id),
            AssetStorage(get_settings()),
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
