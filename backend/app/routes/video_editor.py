from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response

from app.deps import SessionDep, WorkspaceDep
from app.files import AssetError
from app.schemas.video_editor import (
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAvailableAssetListOut,
    VideoEditorProjectCreateIn,
    VideoEditorProjectListOut,
    VideoEditorProjectOut,
    VideoEditorProjectPatchIn,
    VideoEditorRenderCreateIn,
    VideoEditorRenderPreviewIn,
    VideoEditorRenderPreviewOut,
    VideoEditorTaskListOut,
    VideoEditorTaskOut,
    VideoEditorTimelineBatchIn,
    VideoEditorTimelineOut,
)
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.frames import VideoEditorFrames
from app.video_editor.media import VideoEditorMedia, guessed_mime
from app.video_editor.projects import VideoEditorProjects
from app.video_editor.rendering import VideoEditorRenders
from app.video_editor.timeline import VideoEditorTimelines

router = APIRouter(prefix="/video-editor", tags=["video-editor"])


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, VideoEditorNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, VideoEditorValidationError):
        return HTTPException(422, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, AssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc), **exc.detail})
    return HTTPException(500, {"code": "video_editor_error", "message": str(exc)})


@router.get("/projects", response_model=VideoEditorProjectListOut)
async def list_projects(
    session: SessionDep, workspace_id: WorkspaceDep
) -> VideoEditorProjectListOut:
    return await VideoEditorProjects(session, workspace_id).list()


@router.post("/projects", response_model=VideoEditorProjectOut)
async def create_project(
    session: SessionDep, workspace_id: WorkspaceDep, body: VideoEditorProjectCreateIn
) -> VideoEditorProjectOut:
    return await VideoEditorProjects(session, workspace_id).create(body)


@router.get("/projects/{project_id}", response_model=VideoEditorProjectOut)
async def get_project(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> VideoEditorProjectOut:
    try:
        return await VideoEditorProjects(session, workspace_id).get(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}", response_model=VideoEditorProjectOut)
async def patch_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: VideoEditorProjectPatchIn,
) -> VideoEditorProjectOut:
    try:
        return await VideoEditorProjects(session, workspace_id).patch(project_id, body)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VideoEditorProjects(session, workspace_id).delete(project_id, expected_revision)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.get("/import-sources", response_model=VideoEditorAvailableAssetListOut)
async def import_sources(
    session: SessionDep, workspace_id: WorkspaceDep
) -> VideoEditorAvailableAssetListOut:
    return await VideoEditorMedia(session, workspace_id).available()


@router.get("/projects/{project_id}/assets", response_model=VideoEditorAssetListOut)
async def list_assets(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> VideoEditorAssetListOut:
    try:
        return await VideoEditorMedia(session, workspace_id).list(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets", response_model=VideoEditorAssetOut)
async def upload_asset(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
) -> VideoEditorAssetOut:
    try:
        return await VideoEditorMedia(session, workspace_id).upload(project_id, upload)
    except (VideoEditorNotFoundError, AssetError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets/import", response_model=VideoEditorAssetListOut)
async def import_assets(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: VideoEditorAssetImportIn,
) -> VideoEditorAssetListOut:
    try:
        return await VideoEditorMedia(session, workspace_id).import_assets(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError, AssetError) as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/assets/{asset_id}/proxy/retry", response_model=VideoEditorAssetOut
)
async def retry_proxy(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, asset_id: str
) -> VideoEditorAssetOut:
    try:
        return await VideoEditorMedia(session, workspace_id).retry(project_id, asset_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}/assets/{asset_id}")
async def delete_asset(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, asset_id: str
) -> dict[str, bool]:
    try:
        await VideoEditorMedia(session, workspace_id).delete(project_id, asset_id)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.get("/projects/{project_id}/assets/{asset_id}/{variant}")
async def asset_variant(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    asset_id: str,
    variant: str,
) -> FileResponse:
    if variant not in {"proxy", "thumbnail", "waveform"}:
        raise HTTPException(404, {"code": "not_found", "message": "派生素材不存在"})
    try:
        _asset, metadata = await VideoEditorMedia(session, workspace_id).asset(project_id, asset_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
    filename = getattr(metadata, f"{variant}_filename")
    if not filename:
        raise HTTPException(404, {"code": "not_found", "message": "派生素材尚未生成"})
    path = VideoEditorMedia(session, workspace_id).derived_path(project_id, filename)
    if not path.is_file():
        raise HTTPException(404, {"code": "not_found", "message": "派生素材文件不存在"})
    return FileResponse(path, media_type=guessed_mime(path), content_disposition_type="inline")


@router.get("/projects/{project_id}/timeline", response_model=VideoEditorTimelineOut)
async def get_timeline(session: SessionDep, project_id: str) -> VideoEditorTimelineOut:
    try:
        return await VideoEditorTimelines(session).get(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/timeline/operations", response_model=VideoEditorTimelineOut)
async def apply_timeline_operations(
    session: SessionDep, project_id: str, body: VideoEditorTimelineBatchIn
) -> VideoEditorTimelineOut:
    try:
        return await VideoEditorTimelines(session).apply(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/preview/frame")
async def exact_frame(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    revision: int = Query(ge=0),
    time_us: int = Query(alias="timeUs", ge=0),
    width: int = Query(default=960, ge=320, le=1920),
) -> Response:
    try:
        png = await VideoEditorFrames(session, workspace_id).render(
            project_id, revision=revision, time_us=time_us, width=width
        )
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
    return Response(
        png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.post("/projects/{project_id}/renders/preflight", response_model=VideoEditorRenderPreviewOut)
async def render_preflight(
    session: SessionDep, project_id: str, body: VideoEditorRenderPreviewIn
) -> VideoEditorRenderPreviewOut:
    try:
        return await VideoEditorRenders(session).preview(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/renders", response_model=VideoEditorTaskOut)
async def create_render(
    session: SessionDep, project_id: str, body: VideoEditorRenderCreateIn
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/renders", response_model=VideoEditorTaskListOut)
async def list_renders(session: SessionDep, project_id: str) -> VideoEditorTaskListOut:
    return await VideoEditorRenders(session).list(project_id)


@router.get("/projects/{project_id}/renders/{task_id}", response_model=VideoEditorTaskOut)
async def get_render(session: SessionDep, project_id: str, task_id: str) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session).get(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/renders/{task_id}/cancel", response_model=VideoEditorTaskOut)
async def cancel_render(session: SessionDep, project_id: str, task_id: str) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
