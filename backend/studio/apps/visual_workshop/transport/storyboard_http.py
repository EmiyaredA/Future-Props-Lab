"""Shared authenticated transport for project storyboard documents."""

from fastapi import APIRouter

from studio.apps.visual_workshop.storyboard.records import SqlStoryboardRecords
from studio.apps.visual_workshop.storyboard.schemas import StoryboardOut, StoryboardUpdate
from studio.apps.visual_workshop.storyboard.workflow import Storyboards
from studio.apps.visual_workshop.transport.project_errors import resolve
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/projects/{project_id}/storyboard", response_model=StoryboardOut)
async def get_visual_storyboard(session: SessionDep, owner: OwnerDep, project_id: str):
    return await resolve(Storyboards(SqlStoryboardRecords(session, owner)).get(project_id))


@router.put("/projects/{project_id}/storyboard", response_model=StoryboardOut)
async def put_visual_storyboard(
    session: SessionDep, owner: OwnerDep, project_id: str, body: StoryboardUpdate
):
    return await resolve(Storyboards(SqlStoryboardRecords(session, owner)).save(project_id, body))
