"""Published project and initial canvas operations for the Visual owner."""

from fastapi import APIRouter

from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualWorkshopProjectCreateIn,
    VisualWorkshopProjectListOut,
    VisualWorkshopProjectOut,
    VisualWorkshopProjectPatchIn,
)
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .projects import Projects

router = APIRouter(prefix="/v1/visual-workshop/projects", tags=["visual-workshop"])


@router.get("", response_model=VisualWorkshopProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).list()


@router.post("", response_model=VisualWorkshopProjectOut)
async def create_project(
    session: SessionDep, owner_user_id: OwnerDep, body: VisualWorkshopProjectCreateIn
):
    return await Projects(session, owner_user_id).create(body)


@router.get("/{project_id}", response_model=VisualWorkshopProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).get(project_id)


@router.patch("/{project_id}", response_model=VisualWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualWorkshopProjectPatchIn,
):
    return await Projects(session, owner_user_id).patch(project_id, body)


@router.get("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def get_canvas(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).canvas(project_id)
