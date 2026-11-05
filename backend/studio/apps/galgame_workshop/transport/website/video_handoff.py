from fastapi import APIRouter, status

from app.capabilities.asset_store import AssetError
from app.deps import SessionDep
from studio.apps.galgame_workshop.schemas import (
    GalgameVideoEditorHandoffCreateIn,
    GalgameVideoEditorHandoffTaskListOut,
    GalgameVideoEditorHandoffTaskOut,
)
from studio.apps.galgame_workshop.transport.website._shared import _asset_error
from studio.apps.galgame_workshop.video.video_handoff import GalgameVideoEditorHandoffs

router = APIRouter()


@router.post(
    "/{project_id}/video-editor-handoffs",
    response_model=GalgameVideoEditorHandoffTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_handoff(
    session: SessionDep, project_id: str, body: GalgameVideoEditorHandoffCreateIn
) -> GalgameVideoEditorHandoffTaskOut:
    try:
        return await GalgameVideoEditorHandoffs(session).create(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/video-editor-handoffs",
    response_model=GalgameVideoEditorHandoffTaskListOut,
)
async def list_handoffs(
    session: SessionDep, project_id: str
) -> GalgameVideoEditorHandoffTaskListOut:
    try:
        return await GalgameVideoEditorHandoffs(session).list(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/video-editor-handoffs/{task_id}",
    response_model=GalgameVideoEditorHandoffTaskOut,
)
async def get_handoff(
    session: SessionDep, project_id: str, task_id: str
) -> GalgameVideoEditorHandoffTaskOut:
    try:
        return await GalgameVideoEditorHandoffs(session).get(project_id, task_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post(
    "/{project_id}/video-editor-handoffs/{task_id}/cancel",
    response_model=GalgameVideoEditorHandoffTaskOut,
)
async def cancel_handoff(
    session: SessionDep, project_id: str, task_id: str
) -> GalgameVideoEditorHandoffTaskOut:
    try:
        return await GalgameVideoEditorHandoffs(session).cancel(project_id, task_id)
    except AssetError as exc:
        raise _asset_error(exc) from None
