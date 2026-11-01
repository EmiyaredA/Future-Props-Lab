from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask

from app.apps.presentation_workshop.exports import export_project
from app.apps.presentation_workshop.operations import apply_operations as presentation_operations
from app.apps.presentation_workshop.projects import PresentationError, Presentations
from app.apps.presentation_workshop.routes.exchange import router as exchange_router
from app.apps.presentation_workshop.routes.templates import router as templates_router
from app.apps.presentation_workshop.schemas.document import (
    PresentationExportIn,
    PresentationProjectIn,
    PresentationProjectList,
    PresentationProjectOut,
    PresentationProjectPut,
)
from app.apps.presentation_workshop.schemas.operations import PresentationOperationsIn
from app.capabilities.asset_store import AssetStorage
from app.deps import OwnerDep, SessionDep
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError

router = APIRouter(prefix="/presentation-workshop", tags=["presentation-workshop"])
router.include_router(exchange_router)

router.include_router(templates_router)


def mapped(exc: PresentationError | OperationError):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


async def mapped_operation(operation):
    try:
        return await operation
    except (OperationError, PresentationError) as exc:
        raise mapped(exc) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None


@router.get("/projects", response_model=PresentationProjectList)
async def list_projects(
    session: SessionDep,
    owner_user_id: OwnerDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await Presentations(session, owner_user_id).list(query, offset, limit)


@router.post("/projects", response_model=PresentationProjectOut)
async def create_project(session: SessionDep, owner_user_id: OwnerDep, body: PresentationProjectIn):
    try:
        return await Presentations(session, owner_user_id).create(body)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.get("/projects/{project_id}", response_model=PresentationProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    try:
        return await Presentations(session, owner_user_id).get(project_id)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.put("/projects/{project_id}", response_model=PresentationProjectOut)
async def put_project(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: PresentationProjectPut
):
    try:
        return await Presentations(session, owner_user_id).put(project_id, body)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await Presentations(session, owner_user_id).delete(project_id, expected_revision)
        return {"deleted": True}
    except PresentationError as exc:
        raise mapped(exc) from None


@router.post("/projects/{project_id}/operations", response_model=PresentationProjectOut)
async def apply_presentation_operations(
    project_id: str, body: PresentationOperationsIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await mapped_operation(presentation_operations(session, owner_user_id, project_id, body))


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
