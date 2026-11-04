"""Published project and initial Story operations for the Galgame owner."""

from fastapi import APIRouter

from app.apps.galgame_workshop.schemas import (
    GalgameStoryDocumentOut,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
)
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .projects import Projects

router = APIRouter(prefix="/v1/galgame-workshop/projects", tags=["galgame-workshop"])


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    session: SessionDep, owner_user_id: OwnerDep, body: GalgameWorkshopProjectCreateIn
):
    return await Projects(session, owner_user_id).create(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).get(project_id)


@router.get("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def get_story(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).story(project_id)
