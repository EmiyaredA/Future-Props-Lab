from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import FileResponse, Response

from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.policy import download_filename
from app.deps import SessionDep
from app.runtime.config import get_settings
from studio.apps.galgame_workshop.schemas import (
    GalgameVideoExportCreateIn,
    GalgameVideoExportFrameIn,
    GalgameVideoExportPreviewIn,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportTaskListOut,
    GalgameVideoExportTaskOut,
)
from studio.apps.galgame_workshop.transport.website._shared import _asset_error
from studio.apps.galgame_workshop.video.video_export import GalgameVideoExports

router = APIRouter()


@router.post(
    "/{project_id}/video-exports/preview",
    response_model=GalgameVideoExportPreviewOut,
)
async def preview_video_export(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoExportPreviewIn,
) -> GalgameVideoExportPreviewOut:
    try:
        return await GalgameVideoExports(session, get_settings()).preview(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post("/{project_id}/video-exports/frame")
async def exact_video_export_frame(
    session: SessionDep, project_id: str, body: GalgameVideoExportFrameIn
) -> Response:
    try:
        png = await GalgameVideoExports(session, get_settings()).frame(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.post(
    "/{project_id}/video-exports",
    response_model=GalgameVideoExportTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_video_export(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoExportCreateIn,
) -> GalgameVideoExportTaskOut:
    try:
        return await GalgameVideoExports(session, get_settings()).create(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/video-exports",
    response_model=GalgameVideoExportTaskListOut,
)
async def list_video_exports(session: SessionDep, project_id: str) -> GalgameVideoExportTaskListOut:
    try:
        return await GalgameVideoExports(session, get_settings()).list(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/video-exports/{export_id}",
    response_model=GalgameVideoExportTaskOut,
)
async def get_video_export(
    session: SessionDep, project_id: str, export_id: str
) -> GalgameVideoExportTaskOut:
    try:
        return await GalgameVideoExports(session, get_settings()).get(project_id, export_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post(
    "/{project_id}/video-exports/{export_id}/cancel",
    response_model=GalgameVideoExportTaskOut,
)
async def cancel_video_export(
    session: SessionDep, project_id: str, export_id: str
) -> GalgameVideoExportTaskOut:
    try:
        return await GalgameVideoExports(session, get_settings()).cancel(project_id, export_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get("/{project_id}/video-exports/{export_id}/download")
async def download_video_export(
    session: SessionDep, project_id: str, export_id: str
) -> FileResponse:
    try:
        asset, path = await GalgameVideoExports(session, get_settings()).output(
            project_id, export_id
        )
    except AssetError as exc:
        raise _asset_error(exc) from None
    return FileResponse(
        path,
        media_type=asset.mime_type,
        filename=download_filename(asset.display_name, asset.original_filename),
    )
