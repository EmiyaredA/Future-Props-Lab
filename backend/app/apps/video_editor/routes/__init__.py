from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.frames import VideoEditorFrames
from app.apps.video_editor.media import VideoEditorMedia, guessed_mime
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.rendering import VideoEditorRenders
from app.apps.video_editor.schemas import (
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAvailableAssetListOut,
    VideoEditorProjectCreateIn,
    VideoEditorProjectListOut,
    VideoEditorProjectOut,
    VideoEditorProjectPatchIn,
    VideoEditorProjectSnapshotImportOut,
    VideoEditorRenderCreateIn,
    VideoEditorRenderPreviewIn,
    VideoEditorRenderPreviewOut,
    VideoEditorSegmentExportCreateIn,
    VideoEditorTaskListOut,
    VideoEditorTaskOut,
    VideoEditorTimelineBatchIn,
    VideoEditorTimelineOut,
)
from app.apps.video_editor.segment_exports import VideoEditorSegmentExports
from app.apps.video_editor.segment_files import download_segments
from app.apps.video_editor.snapshots import VideoEditorProjectSnapshots
from app.apps.video_editor.timeline import VideoEditorTimelines
from app.capabilities.asset_store import (
    AssetError,
    AssetStorage,
    ProjectFolderError,
    ProjectSnapshotError,
    open_project_folder,
)
from app.deps import SessionDep, StudioAuth, WorkspaceDep
from app.runtime.config import get_settings
from app.capabilities.asset_store.schemas.project_snapshots import ProjectFolderOpenOut

router = APIRouter(prefix="/video-editor", tags=["video-editor"])


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, VideoEditorNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, VideoEditorValidationError):
        return HTTPException(422, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, AssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc), **exc.detail})
    if isinstance(exc, (ProjectSnapshotError, ProjectFolderError)):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
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


@router.post("/projects/snapshot-imports", response_model=VideoEditorProjectSnapshotImportOut)
async def import_project_snapshot(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    file: Annotated[UploadFile, File()],
) -> VideoEditorProjectSnapshotImportOut:
    try:
        return await VideoEditorProjectSnapshots(
            session, get_settings(), workspace_id
        ).import_snapshot(file)
    except ProjectSnapshotError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=VideoEditorProjectOut)
async def get_project(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> VideoEditorProjectOut:
    try:
        return await VideoEditorProjects(session, workspace_id).get(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/snapshot",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_project_snapshot(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> FileResponse:
    try:
        exported = await VideoEditorProjectSnapshots(session, get_settings(), workspace_id).export(
            project_id
        )
    except ProjectSnapshotError as exc:
        raise _error(exc) from None
    return FileResponse(
        exported.path,
        media_type="application/zip",
        filename=exported.filename,
        background=BackgroundTask(exported.path.unlink, missing_ok=True),
    )


@router.post("/projects/{project_id}/open-folder", response_model=ProjectFolderOpenOut)
async def reveal_project_folder(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
) -> ProjectFolderOpenOut:
    if principal.auth_kind != "session":
        raise HTTPException(
            403,
            {"code": "browser_session_required", "message": "打开文件夹必须使用浏览器 Session"},
        )
    try:
        await VideoEditorProjects(session, workspace_id).get(project_id)
        await open_project_folder(
            AssetStorage(get_settings()),
            "video-editor",
            project_id,
            workspace_id=workspace_id,
        )
    except (VideoEditorNotFoundError, ProjectFolderError) as exc:
        raise _error(exc) from None
    return ProjectFolderOpenOut()


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
async def get_timeline(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> VideoEditorTimelineOut:
    try:
        return await VideoEditorTimelines(session, workspace_id).get(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/timeline/operations", response_model=VideoEditorTimelineOut)
async def apply_timeline_operations(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: VideoEditorTimelineBatchIn,
) -> VideoEditorTimelineOut:
    try:
        return await VideoEditorTimelines(session, workspace_id).apply(project_id, body)
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


@router.get(
    "/projects/{project_id}/text-clips/{clip_id}/layer",
    response_class=Response,
    responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def text_clip_layer(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    clip_id: str,
    revision: int = Query(ge=0),
) -> Response:
    try:
        png = await VideoEditorFrames(session, workspace_id).text_layer(
            project_id, clip_id=clip_id, revision=revision
        )
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-cache"})


@router.post("/projects/{project_id}/renders/preflight", response_model=VideoEditorRenderPreviewOut)
async def render_preflight(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: VideoEditorRenderPreviewIn,
) -> VideoEditorRenderPreviewOut:
    try:
        return await VideoEditorRenders(session, workspace_id).preview(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/renders", response_model=VideoEditorTaskOut)
async def create_render(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: VideoEditorRenderCreateIn,
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session, workspace_id).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/renders", response_model=VideoEditorTaskListOut)
async def list_renders(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> VideoEditorTaskListOut:
    try:
        return await VideoEditorRenders(session, workspace_id).list(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/renders/{task_id}", response_model=VideoEditorTaskOut)
async def get_render(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session, workspace_id).get(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/renders/{task_id}/cancel", response_model=VideoEditorTaskOut)
async def cancel_render(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session, workspace_id).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}/renders/{task_id}")
async def delete_render(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VideoEditorRenders(session, workspace_id).delete(
            project_id, task_id, expected_revision
        )
    except (VideoEditorNotFoundError, VideoEditorValidationError, AssetError) as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.post("/projects/{project_id}/segment-exports", response_model=VideoEditorTaskOut)
async def create_segment_export(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: VideoEditorSegmentExportCreateIn,
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorSegmentExports(session, workspace_id).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/segment-exports", response_model=VideoEditorTaskListOut)
async def list_segment_exports(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> VideoEditorTaskListOut:
    try:
        return await VideoEditorSegmentExports(session, workspace_id).list(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/segment-exports/{task_id}",
    response_model=VideoEditorTaskOut,
)
async def get_segment_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorSegmentExports(session, workspace_id).get(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/segment-exports/{task_id}/cancel",
    response_model=VideoEditorTaskOut,
)
async def cancel_segment_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorSegmentExports(session, workspace_id).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/segment-exports/{task_id}/download",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def download_segment_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
) -> FileResponse:
    try:
        path = await download_segments(session, get_settings(), workspace_id, project_id, task_id)
    except (VideoEditorNotFoundError, AssetError) as exc:
        raise _error(exc) from None
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"segments-{task_id[:8]}.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )
