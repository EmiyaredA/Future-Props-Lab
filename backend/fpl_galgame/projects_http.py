"""Published project and initial Story operations for the Galgame owner."""

from contextlib import asynccontextmanager

from fastapi import APIRouter, Request

from app.apps.galgame_workshop.schemas import (
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
)
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .projects import Projects
from .story_writes import PREFIX, StoryWrites


@asynccontextmanager
async def lifespan(app):
    delivery = app.state.reference_delivery
    try:
        if app.state.run_reference_worker:
            await delivery.start()
        yield
    finally:
        await delivery.stop()
        await app.state.retention_client.close()


router = APIRouter(prefix=PREFIX, tags=["galgame-workshop"], lifespan=lifespan)


def story_writes(request, session, owner):
    return StoryWrites(
        session, owner, request.app.state.story_references, request.state.service_assertion
    )


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: GalgameWorkshopProjectCreateIn,
):
    return await story_writes(request, session, owner_user_id).create_project(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).get(project_id)


@router.get("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def get_story(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).story(project_id)


@router.put("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def put_story(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryDocumentPutIn,
):
    return await story_writes(request, session, owner_user_id).put(project_id, body)
