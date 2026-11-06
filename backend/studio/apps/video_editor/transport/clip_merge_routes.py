"""Expose the published Video clip-merge submission and cancellation routes."""

from fastapi import APIRouter, Request

from studio.apps.video_editor.clip_merge_dispatch import dispatch_clip_merge
from studio.apps.video_editor.clip_merging.tasks import VideoEditorClipMerges
from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.schemas import VideoEditorClipMergeCreateIn, VideoEditorTaskOut
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()
PATH = "/projects/{project_id}/clip-merges"


@router.post(PATH, response_model=VideoEditorTaskOut)
async def create_clip_merge(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorClipMergeCreateIn,
) -> VideoEditorTaskOut:
    if request.app.state.render_delivery is None:
        raise _error(VideoEditorUnavailableError("剪辑合并暂不可用"))
    try:
        assets = request.app.state.video_assets(request, session, owner_user_id)
        return await VideoEditorClipMerges(
            session, owner_user_id, dispatch=dispatch_clip_merge
        ).create(project_id, body, assets=assets)
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None


@router.post(PATH + "/{task_id}/cancel", response_model=VideoEditorTaskOut)
async def cancel_clip_merge(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorClipMerges(session, owner_user_id).cancel(project_id, task_id)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
