"""The shared read-only render preflight operation."""

from fastapi import APIRouter

from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.render_preflight import VideoRenderPreflight
from studio.apps.video_editor.schemas import VideoEditorRenderPreviewIn, VideoEditorRenderPreviewOut
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.post("/projects/{project_id}/renders/preflight", response_model=VideoEditorRenderPreviewOut)
async def render_preflight(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorRenderPreviewIn,
) -> VideoEditorRenderPreviewOut:
    try:
        return await VideoRenderPreflight(session, owner_user_id).preview(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
