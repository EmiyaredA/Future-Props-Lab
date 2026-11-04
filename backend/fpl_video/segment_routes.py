"""Preserve public Video segment creation, cancellation and ZIP download."""

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from app.apps.video_editor.routes.errors import _error
from app.apps.video_editor.schemas import VideoEditorSegmentExportCreateIn, VideoEditorTaskOut
from app.capabilities.asset_store.errors import AssetError
from app.deps import OwnerDep, SessionDep

from .segment_downloads import segment_download
from .segment_requests import SegmentRequests

router = APIRouter()
PATH = "/projects/{project_id}/segment-exports"


@router.post(PATH, response_model=VideoEditorTaskOut)
async def create_segment_export(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorSegmentExportCreateIn,
) -> VideoEditorTaskOut:
    if request.app.state.render_delivery is None:
        raise _error(VideoEditorUnavailableError("分段导出暂不可用"))
    try:
        return await SegmentRequests(session, owner_user_id, request).create(project_id, body)
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None


@router.post(PATH + "/{task_id}/cancel", response_model=VideoEditorTaskOut)
async def cancel_segment_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await SegmentRequests(session, owner_user_id).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get(
    PATH + "/{task_id}/download",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def download_segment_export(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
) -> FileResponse:
    try:
        return await segment_download(request, session, owner_user_id, project_id, task_id)
    except (VideoEditorNotFoundError, VideoEditorUnavailableError, AssetError) as exc:
        raise _error(exc) from None
