"""Public Video project metadata and timeline reads."""

from fastapi import APIRouter, Query

from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import (
    VideoEditorProjectCreateIn,
    VideoEditorProjectListOut,
    VideoEditorProjectOut,
    VideoEditorProjectPatchIn,
    VideoEditorTimelineOut,
)
from studio.apps.video_editor.timeline_read import VideoTimelineRead
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.get("/projects", response_model=VideoEditorProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep) -> VideoEditorProjectListOut:
    return await VideoEditorProjects(session, owner_user_id).list()


@router.post("/projects", response_model=VideoEditorProjectOut)
async def create_project(
    session: SessionDep, owner_user_id: OwnerDep, body: VideoEditorProjectCreateIn
) -> VideoEditorProjectOut:
    try:
        return await VideoEditorProjects(session, owner_user_id).create(body)
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=VideoEditorProjectOut)
async def get_project(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VideoEditorProjectOut:
    try:
        return await VideoEditorProjects(session, owner_user_id).get(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}", response_model=VideoEditorProjectOut)
async def patch_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorProjectPatchIn,
) -> VideoEditorProjectOut:
    try:
        return await VideoEditorProjects(session, owner_user_id).patch(project_id, body)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/timeline", response_model=VideoEditorTimelineOut)
async def get_timeline(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VideoEditorTimelineOut:
    try:
        return await VideoTimelineRead(session, owner_user_id).get(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VideoEditorProjects(session, owner_user_id).delete(project_id, expected_revision)
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None
    return {"deleted": True}
