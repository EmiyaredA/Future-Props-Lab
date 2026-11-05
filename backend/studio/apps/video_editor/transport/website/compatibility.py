from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from app.capabilities.asset_store import (
    AssetError,
    AssetStorage,
    ProjectFolderError,
    ProjectSnapshotError,
    open_project_folder,
)
from studio.apps.video_editor.audio_alignment.audio_matching import VideoEditorAudioMatching
from studio.apps.video_editor.baking.asset_bakes import VideoEditorAssetBakes
from studio.apps.video_editor.clip_merging.tasks import VideoEditorClipMerges
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.frames import VideoEditorFrames
from studio.apps.video_editor.handoffs.segment_exports import VideoEditorSegmentExports
from studio.apps.video_editor.handoffs.segment_files import download_segments
from studio.apps.video_editor.media import VideoEditorMedia, guessed_mime
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.rendering import VideoEditorRenders
from studio.apps.video_editor.schemas import (
    AudioSeamCandidatesIn,
    AudioSeamCandidatesOut,
    VideoEditorAssetBakeCreateIn,
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAssetPatchIn,
    VideoEditorAvailableAssetListOut,
    VideoEditorProjectSnapshotImportOut,
    VideoEditorRenderCreateIn,
    VideoEditorSegmentExportCreateIn,
    VideoEditorTaskOut,
)
from studio.apps.video_editor.schemas.clip_merge import VideoEditorClipMergeCreateIn
from studio.apps.video_editor.snapshots import VideoEditorProjectSnapshots
from studio.apps.video_editor.transport.website.errors import _error as _public_error
from studio.apps.video_editor.transport.website.projects import router as projects_router
from studio.apps.video_editor.transport.website.render_preflight import router as preflight_router
from studio.apps.video_editor.transport.website.tasks import router as tasks_router
from studio.apps.video_editor.transport.website.timeline import router as timeline_router
from studio.assembly.http_dependencies import OwnerDep, SessionDep, StudioAuth
from studio.config.settings import get_settings
from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut

router = APIRouter(prefix="/video-editor", tags=["video-editor"])


def _error(exc):
    if isinstance(exc, (ProjectSnapshotError, ProjectFolderError)):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
    return _public_error(exc)


@router.post("/projects/snapshot-imports", response_model=VideoEditorProjectSnapshotImportOut)
async def import_project_snapshot(
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
) -> VideoEditorProjectSnapshotImportOut:
    try:
        return await VideoEditorProjectSnapshots(
            session, get_settings(), owner_user_id
        ).import_snapshot(file)
    except ProjectSnapshotError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/snapshot",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_project_snapshot(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        exported = await VideoEditorProjectSnapshots(session, get_settings(), owner_user_id).export(
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
    owner_user_id: OwnerDep,
    project_id: str,
) -> ProjectFolderOpenOut:
    if principal.auth_kind != "session":
        raise HTTPException(
            403,
            {"code": "browser_session_required", "message": "打开文件夹必须使用浏览器 Session"},
        )
    try:
        await VideoEditorProjects(session, owner_user_id).get(project_id)
        await open_project_folder(
            AssetStorage(get_settings()),
            "video-editor",
            project_id,
            owner_user_id=owner_user_id,
        )
    except (VideoEditorNotFoundError, ProjectFolderError) as exc:
        raise _error(exc) from None
    return ProjectFolderOpenOut()


@router.get("/import-sources", response_model=VideoEditorAvailableAssetListOut)
async def import_sources(
    session: SessionDep, owner_user_id: OwnerDep
) -> VideoEditorAvailableAssetListOut:
    return await VideoEditorMedia(session, owner_user_id).available()


@router.get("/projects/{project_id}/assets", response_model=VideoEditorAssetListOut)
async def list_assets(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VideoEditorAssetListOut:
    try:
        return await VideoEditorMedia(session, owner_user_id).list(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets", response_model=VideoEditorAssetOut)
async def upload_asset(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
) -> VideoEditorAssetOut:
    try:
        return await VideoEditorMedia(session, owner_user_id).upload(project_id, upload)
    except (VideoEditorNotFoundError, AssetError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets/import", response_model=VideoEditorAssetListOut)
async def import_assets(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorAssetImportIn,
) -> VideoEditorAssetListOut:
    try:
        return await VideoEditorMedia(session, owner_user_id).import_assets(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError, AssetError) as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/assets/{asset_id}/proxy/retry", response_model=VideoEditorAssetOut
)
async def retry_proxy(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, asset_id: str
) -> VideoEditorAssetOut:
    try:
        return await VideoEditorMedia(session, owner_user_id).retry(project_id, asset_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}/assets/{asset_id}", response_model=VideoEditorAssetOut)
async def patch_asset(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    body: VideoEditorAssetPatchIn,
) -> VideoEditorAssetOut:
    try:
        return await VideoEditorMedia(session, owner_user_id).patch(project_id, asset_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets/{asset_id}/bakes", response_model=VideoEditorTaskOut)
async def create_asset_bake(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    body: VideoEditorAssetBakeCreateIn,
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorAssetBakes(session, owner_user_id).create(
            project_id, asset_id, body
        )
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}/assets/{asset_id}")
async def delete_asset(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, asset_id: str
) -> dict[str, bool]:
    try:
        await VideoEditorMedia(session, owner_user_id).delete(project_id, asset_id)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.get("/projects/{project_id}/assets/{asset_id}/{variant}")
async def asset_variant(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    variant: str,
) -> FileResponse:
    if variant not in {"proxy", "thumbnail", "waveform"}:
        raise HTTPException(404, {"code": "not_found", "message": "派生素材不存在"})
    try:
        _asset, metadata = await VideoEditorMedia(session, owner_user_id).asset(
            project_id, asset_id
        )
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
    filename = getattr(metadata, f"{variant}_filename")
    if not filename:
        raise HTTPException(404, {"code": "not_found", "message": "派生素材尚未生成"})
    path = VideoEditorMedia(session, owner_user_id).derived_path(project_id, filename)
    if not path.is_file():
        raise HTTPException(404, {"code": "not_found", "message": "派生素材文件不存在"})
    return FileResponse(path, media_type=guessed_mime(path), content_disposition_type="inline")


@router.post(
    "/projects/{project_id}/audio-seams/candidates",
    response_model=AudioSeamCandidatesOut,
)
async def audio_seam_candidates(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: AudioSeamCandidatesIn,
) -> AudioSeamCandidatesOut:
    try:
        return await VideoEditorAudioMatching(session, owner_user_id).candidates(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/preview/frame")
async def exact_frame(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    revision: int = Query(ge=0),
    time_us: int = Query(alias="timeUs", ge=0),
    width: int = Query(default=960, ge=320, le=1920),
    without_chroma_clip_id: str | None = Query(default=None, alias="withoutChromaClipId"),
) -> Response:
    try:
        png = await VideoEditorFrames(session, owner_user_id).render(
            project_id,
            revision=revision,
            time_us=time_us,
            width=width,
            without_chroma_clip_id=without_chroma_clip_id,
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
    owner_user_id: OwnerDep,
    project_id: str,
    clip_id: str,
    revision: int = Query(ge=0),
) -> Response:
    try:
        png = await VideoEditorFrames(session, owner_user_id).text_layer(
            project_id, clip_id=clip_id, revision=revision
        )
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-cache"})


@router.post("/projects/{project_id}/renders", response_model=VideoEditorTaskOut)
async def create_render(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorRenderCreateIn,
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session, owner_user_id).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/renders/{task_id}/cancel", response_model=VideoEditorTaskOut)
async def cancel_render(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorRenders(session, owner_user_id).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}/renders/{task_id}")
async def delete_render(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VideoEditorRenders(session, owner_user_id).delete(
            project_id, task_id, expected_revision
        )
    except (VideoEditorNotFoundError, VideoEditorValidationError, AssetError) as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.post("/projects/{project_id}/segment-exports", response_model=VideoEditorTaskOut)
async def create_segment_export(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorSegmentExportCreateIn,
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorSegmentExports(session, owner_user_id).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/segment-exports/{task_id}/cancel",
    response_model=VideoEditorTaskOut,
)
async def cancel_segment_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorSegmentExports(session, owner_user_id).cancel(project_id, task_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/segment-exports/{task_id}/download",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def download_segment_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> FileResponse:
    try:
        path = await download_segments(session, get_settings(), owner_user_id, project_id, task_id)
    except (VideoEditorNotFoundError, AssetError) as exc:
        raise _error(exc) from None
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"segments-{task_id[:8]}.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.post("/projects/{project_id}/clip-merges", response_model=VideoEditorTaskOut)
async def create_clip_merge(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorClipMergeCreateIn,
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorClipMerges(session, owner_user_id).create(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/clip-merges/{task_id}/cancel", response_model=VideoEditorTaskOut
)
async def cancel_clip_merge(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoEditorClipMerges(session, owner_user_id).cancel(project_id, task_id)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise _error(exc) from None


router.include_router(projects_router)
router.include_router(timeline_router)
router.include_router(tasks_router)
router.include_router(preflight_router)
