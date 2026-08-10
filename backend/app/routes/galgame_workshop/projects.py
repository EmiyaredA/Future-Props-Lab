from __future__ import annotations

# ruff: noqa: F405
from fastapi import APIRouter

from app.routes.galgame_workshop._shared import *  # noqa: F403
from app.routes.galgame_workshop._shared import _not_found

router = APIRouter()


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep) -> GalgameWorkshopProjectListOut:
    return await GalgameWorkshopProjects(session).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    session: SessionDep,
    body: GalgameWorkshopProjectCreateIn,
) -> GalgameWorkshopProjectOut:
    return await GalgameWorkshopProjects(session).create(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, project_id: str) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session).get(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.patch("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    project_id: str,
    body: GalgameWorkshopProjectPatchIn,
) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session).patch(project_id, body)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except GalgameStoryNotReadyError as exc:
        raise HTTPException(
            422,
            {
                "code": "story_not_ready",
                "message": str(exc),
                "report": exc.report.model_dump(mode="json"),
            },
        ) from None


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await GalgameWorkshopProjects(session).delete(project_id, expected_revision)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    return {"deleted": True}
