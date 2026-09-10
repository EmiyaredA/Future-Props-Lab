from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.core.config import get_settings
from app.deps import SessionDep, WorkspaceDep
from app.files import AssetStorage
from app.presentation_workshop.exports import export_project
from app.presentation_workshop.projects import PresentationError, Presentations
from app.schemas.presentation_workshop import (
    PresentationExportIn,
    PresentationProjectIn,
    PresentationProjectList,
    PresentationProjectOut,
    PresentationProjectPut,
)

router = APIRouter(prefix="/presentation-workshop", tags=["presentation-workshop"])


def mapped(exc: PresentationError):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/projects", response_model=PresentationProjectList)
async def list_projects(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await Presentations(session, workspace_id).list(query, offset, limit)


@router.post("/projects", response_model=PresentationProjectOut)
async def create_project(
    session: SessionDep, workspace_id: WorkspaceDep, body: PresentationProjectIn
):
    try:
        return await Presentations(session, workspace_id).create(body)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.get("/projects/{project_id}", response_model=PresentationProjectOut)
async def get_project(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    try:
        return await Presentations(session, workspace_id).get(project_id)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.put("/projects/{project_id}", response_model=PresentationProjectOut)
async def put_project(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: PresentationProjectPut
):
    try:
        return await Presentations(session, workspace_id).put(project_id, body)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await Presentations(session, workspace_id).delete(project_id, expected_revision)
        return {"deleted": True}
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
async def export_pptx(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: PresentationExportIn
):
    try:
        result = await export_project(
            Presentations(session, workspace_id),
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
