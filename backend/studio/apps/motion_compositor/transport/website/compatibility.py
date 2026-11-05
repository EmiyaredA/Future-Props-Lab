from __future__ import annotations

import asyncio
import io
import zipfile
from typing import Annotated

from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from studio.apps.media_rendering.local.motion_frames import MotionFrameRenderer
from studio.apps.motion_compositor.assets import MotionAssets
from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionProjects
from studio.apps.motion_compositor.schemas import (
    AssetImportIn,
    AssetListOut,
    AssetOut,
    ExportCreateIn,
    ExportListOut,
    ExportOut,
    HandoffIn,
    HandoffOut,
    ImportSourceListOut,
    ProjectOut,
)
from studio.apps.motion_compositor.snapshots import MotionSnapshots
from studio.apps.motion_compositor.transport.website.errors import _error
from studio.apps.motion_compositor.transport.website.projects import router as projects
from studio.apps.motion_compositor.website.exports import MotionExports
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.revisions import RevisionConflictError

router = APIRouter(prefix="/motion-compositor", tags=["motion-compositor"])


@router.post("/projects/snapshot-imports", response_model=ProjectOut)
async def import_snapshot(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
) -> ProjectOut:
    try:
        return await MotionSnapshots(
            session, owner_user_id, settings=request.app.state.settings
        ).import_snapshot(file)
    except (MotionInvalid, MotionNotFound, AssetError, ValueError, zipfile.BadZipFile) as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/snapshot", responses={200: {"content": {"application/zip": {}}}}
)
async def export_snapshot(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        path = await MotionSnapshots(
            session, owner_user_id, settings=request.app.state.settings
        ).export(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None
    return FileResponse(
        path,
        media_type="application/zip",
        filename="motion-project.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.get("/import-sources", response_model=ImportSourceListOut)
async def import_sources(
    request: Request, session: SessionDep, owner_user_id: OwnerDep
) -> ImportSourceListOut:
    return await MotionAssets(session, owner_user_id, settings=request.app.state.settings).sources()


@router.get("/projects/{project_id}/assets", response_model=AssetListOut)
async def list_assets(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> AssetListOut:
    try:
        return await MotionAssets(session, owner_user_id, settings=request.app.state.settings).list(
            project_id
        )
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets", response_model=AssetOut)
async def upload_asset(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    file: Annotated[UploadFile, File()],
) -> AssetOut:
    try:
        return await MotionAssets(
            session, owner_user_id, settings=request.app.state.settings
        ).upload(project_id, file)
    except (MotionNotFound, AssetError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets/import", response_model=AssetListOut)
async def import_assets(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: AssetImportIn,
) -> AssetListOut:
    try:
        return await MotionAssets(
            session, owner_user_id, settings=request.app.state.settings
        ).import_assets(project_id, body)
    except (MotionNotFound, MotionInvalid, AssetError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/assets/{asset_id}/file")
async def asset_file(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str, asset_id: str
) -> FileResponse:
    assets = MotionAssets(session, owner_user_id, settings=request.app.state.settings)
    try:
        row = await assets.asset(project_id, asset_id)
    except MotionNotFound as exc:
        raise _error(exc) from None
    return FileResponse(
        assets.storage.path_for(row), media_type=row.mime_type, content_disposition_type="inline"
    )


@router.get("/projects/{project_id}/preview/frame", responses={200: {"content": {"image/png": {}}}})
async def exact_frame(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    frame: int = Query(ge=0),
    revision: int | None = Query(default=None, ge=0),
) -> Response:
    try:
        snapshot = await MotionProjects(session, owner_user_id).document(project_id)
        if revision is not None and revision != snapshot.revision:
            raise RevisionConflictError(
                revision, snapshot.revision, snapshot.model_dump(mode="json", by_alias=True)
            )
        document = snapshot.document
        if frame >= document.settings.duration_frames:
            raise MotionInvalid("帧超出项目时长")
        assets = await MotionAssets(
            session, owner_user_id, settings=request.app.state.settings
        ).paths(project_id)
        image = await asyncio.to_thread(MotionFrameRenderer(document, assets).render, frame)
    except (MotionNotFound, MotionInvalid) as exc:
        raise _error(exc) from None
    payload = io.BytesIO()
    await asyncio.to_thread(image.save, payload, format="PNG")
    return Response(
        payload.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"}
    )


@router.post("/projects/{project_id}/exports", response_model=ExportOut)
async def create_export(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: ExportCreateIn,
) -> ExportOut:
    try:
        return await MotionExports(
            session, owner_user_id, settings=request.app.state.settings
        ).create(project_id, body)
    except (MotionNotFound, MotionInvalid) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/exports", response_model=ExportListOut)
async def list_exports(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> ExportListOut:
    try:
        return await MotionExports(
            session, owner_user_id, settings=request.app.state.settings
        ).list(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/exports/{task_id}", response_model=ExportOut)
async def get_export(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> ExportOut:
    try:
        return await MotionExports(session, owner_user_id, settings=request.app.state.settings).get(
            project_id, task_id
        )
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/exports/{task_id}/cancel", response_model=ExportOut)
async def cancel_export(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> ExportOut:
    try:
        return await MotionExports(
            session, owner_user_id, settings=request.app.state.settings
        ).cancel(project_id, task_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/exports/{task_id}/download/{format_name}")
async def download_export(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
    format_name: str,
) -> FileResponse:
    try:
        path, filename = await MotionExports(
            session, owner_user_id, settings=request.app.state.settings
        ).download(project_id, task_id, format_name)
    except MotionNotFound as exc:
        raise _error(exc) from None
    return FileResponse(path, filename=filename)


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
        return await MotionExports(
            session, owner_user_id, settings=request.app.state.settings
        ).handoff(project_id, task_id, body)
    except (MotionNotFound, MotionInvalid) as exc:
        raise _error(exc) from None


router.include_router(projects)
