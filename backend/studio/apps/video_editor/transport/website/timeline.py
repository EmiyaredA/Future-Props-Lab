"""Publish the timeline editing operation in both site assemblies."""

from fastapi import APIRouter

from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.schemas import VideoEditorTimelineBatchIn, VideoEditorTimelineOut
from studio.apps.video_editor.timeline import VideoEditorTimelines
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.post("/projects/{project_id}/timeline/operations", response_model=VideoEditorTimelineOut)
async def apply_timeline_operations(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorTimelineBatchIn,
) -> VideoEditorTimelineOut:
    try:
        return await VideoEditorTimelines(session, owner_user_id).apply(project_id, body)
    except (
        VideoEditorNotFoundError,
        VideoEditorValidationError,
        VideoEditorUnavailableError,
    ) as exc:
        raise _error(exc) from None
