"""Publish Video movie submission and cancellation on their existing routes."""

from fastapi import APIRouter, Query, Request

from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from app.apps.video_editor.routes.errors import _error
from app.apps.video_editor.schemas import VideoEditorRenderCreateIn, VideoEditorTaskOut
from app.capabilities.asset_store.errors import AssetError
from app.deps import OwnerDep, SessionDep

from .render_removal import RenderRemoval
from .render_requests import RenderRequests

router = APIRouter()
PATH = "/projects/{project_id}/renders"


@router.post(PATH, response_model=VideoEditorTaskOut)
async def create_render(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorRenderCreateIn,
) -> VideoEditorTaskOut:
    if request.app.state.render_delivery is None:
        raise _error(VideoEditorUnavailableError("剪辑成片渲染暂不可用"))
    try:
        return await RenderRequests(session, owner_user_id).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post(PATH + "/{task_id}/cancel", response_model=VideoEditorTaskOut)
async def cancel_render(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await RenderRequests(session, owner_user_id).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.delete(PATH + "/{task_id}")
async def delete_render(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await RenderRemoval(request, session, owner_user_id).remove(
            project_id, task_id, expected_revision
        )
    except (
        VideoEditorNotFoundError,
        VideoEditorValidationError,
        VideoEditorUnavailableError,
        AssetError,
    ) as exc:
        raise _error(exc) from None
    return {"deleted": True}
