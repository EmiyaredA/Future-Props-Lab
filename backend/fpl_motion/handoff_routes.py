"""Preserve the browser-facing Motion-to-Video handoff operation."""

from fastapi import APIRouter, Request

from app.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionUnavailable
from app.apps.motion_compositor.routes.errors import _error
from app.apps.motion_compositor.schemas import HandoffIn, HandoffOut
from app.deps import OwnerDep, SessionDep

from .handoffs import transfer

router = APIRouter()


@router.post(
    "/projects/{project_id}/exports/{task_id}/video-editor-handoffs", response_model=HandoffOut
)
async def send_to_video_editor(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
    body: HandoffIn,
) -> HandoffOut:
    try:
        return await transfer(request, session, owner_user_id, project_id, task_id, body)
    except (MotionNotFound, MotionInvalid, MotionUnavailable) as exc:
        raise _error(exc) from None
