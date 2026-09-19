from fastapi import APIRouter, HTTPException, Query

from app.apps.director_desk.projects import DirectorDeskError, DirectorDeskProjects
from app.apps.director_desk.schemas import (
    DirectorProjectCreate,
    DirectorProjectList,
    DirectorProjectOut,
    DirectorProjectPatch,
)
from app.deps import SessionDep, WorkspaceDep

router = APIRouter(prefix="/director-desk", tags=["director-desk"])


def mapped(exc: DirectorDeskError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/projects", response_model=DirectorProjectList)
async def list_projects(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await DirectorDeskProjects(session, workspace_id).list(query, offset, limit)


@router.post("/projects", response_model=DirectorProjectOut, status_code=201)
async def create_project(
    session: SessionDep, workspace_id: WorkspaceDep, body: DirectorProjectCreate
):
    return await DirectorDeskProjects(session, workspace_id).create(body)


@router.get("/projects/{project_id}", response_model=DirectorProjectOut)
async def get_project(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    try:
        return await DirectorDeskProjects(session, workspace_id).get(project_id)
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.patch("/projects/{project_id}", response_model=DirectorProjectOut)
async def patch_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: DirectorProjectPatch,
):
    try:
        return await DirectorDeskProjects(session, workspace_id).patch(project_id, body)
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await DirectorDeskProjects(session, workspace_id).delete(project_id, expected_revision)
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return {"deleted": True}
