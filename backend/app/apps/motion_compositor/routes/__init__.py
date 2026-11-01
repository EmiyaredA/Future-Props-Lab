from __future__ import annotations

import asyncio
import io
import zipfile
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from app.apps.motion_compositor.assets import MotionAssets
from app.apps.motion_compositor.exports import MotionExports
from app.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionProjects
from app.apps.motion_compositor.schemas import (
    AssetImportIn,
    AssetListOut,
    AssetOut,
    DocumentOut,
    ExportCreateIn,
    ExportListOut,
    ExportOut,
    HandoffIn,
    HandoffOut,
    ImportSourceListOut,
    OperationBatchIn,
    ProjectCreateIn,
    ProjectListOut,
    ProjectOut,
    ProjectPatchIn,
)
from app.apps.motion_compositor.snapshots import MotionSnapshots
from app.capabilities.asset_store.library import AssetError
from app.capabilities.media_rendering.motion_frames import MotionFrameRenderer
from app.deps import OwnerDep, SessionDep
from app.runtime.revisions import RevisionConflictError

router = APIRouter(prefix="/motion-compositor", tags=["motion-compositor"])


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, MotionNotFound):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, (MotionInvalid, ValueError, zipfile.BadZipFile)):
        return HTTPException(422, {"code": "invalid_motion", "message": str(exc)})
    if isinstance(exc, AssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
    return HTTPException(500, {"code": "motion_error", "message": str(exc)})


@router.get("/projects", response_model=ProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep) -> ProjectListOut:
    return await MotionProjects(session, owner_user_id).list()


@router.post("/projects", response_model=ProjectOut)
async def create_project(
    session: SessionDep, owner_user_id: OwnerDep, body: ProjectCreateIn
) -> ProjectOut:
    return await MotionProjects(session, owner_user_id).create(body)


@router.post("/projects/snapshot-imports", response_model=ProjectOut)
async def import_snapshot(
    session: SessionDep, owner_user_id: OwnerDep, file: Annotated[UploadFile, File()]
) -> ProjectOut:
    try:
        return await MotionSnapshots(session, owner_user_id).import_snapshot(file)
    except (MotionInvalid, MotionNotFound, AssetError, ValueError, zipfile.BadZipFile) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str) -> ProjectOut:
    try:
        return await MotionProjects(session, owner_user_id).get(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/snapshot", responses={200: {"content": {"application/zip": {}}}}
)
async def export_snapshot(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        path = await MotionSnapshots(session, owner_user_id).export(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None
    return FileResponse(
        path,
        media_type="application/zip",
        filename="motion-project.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def patch_project(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: ProjectPatchIn
) -> ProjectOut:
    try:
        return await MotionProjects(session, owner_user_id).patch(project_id, body)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(alias="expectedRevision", ge=0),
) -> dict[str, bool]:
    try:
        await MotionProjects(session, owner_user_id).delete(project_id, expected_revision)
    except MotionNotFound as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.get("/projects/{project_id}/document", response_model=DocumentOut)
async def get_document(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> DocumentOut:
    try:
        return await MotionProjects(session, owner_user_id).document(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/document/operations", response_model=DocumentOut)
async def edit_document(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: OperationBatchIn
) -> DocumentOut:
    try:
        return await MotionProjects(session, owner_user_id).apply(project_id, body)
    except (MotionInvalid, MotionNotFound) as exc:
        raise _error(exc) from None


@router.get("/import-sources", response_model=ImportSourceListOut)
async def import_sources(session: SessionDep, owner_user_id: OwnerDep) -> ImportSourceListOut:
    return await MotionAssets(session, owner_user_id).sources()


@router.get("/projects/{project_id}/assets", response_model=AssetListOut)
async def list_assets(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> AssetListOut:
    try:
        return await MotionAssets(session, owner_user_id).list(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets", response_model=AssetOut)
async def upload_asset(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    file: Annotated[UploadFile, File()],
) -> AssetOut:
    try:
        return await MotionAssets(session, owner_user_id).upload(project_id, file)
    except (MotionNotFound, AssetError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/assets/import", response_model=AssetListOut)
async def import_assets(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: AssetImportIn
) -> AssetListOut:
    try:
        return await MotionAssets(session, owner_user_id).import_assets(project_id, body)
    except (MotionNotFound, MotionInvalid, AssetError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/assets/{asset_id}/file")
async def asset_file(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, asset_id: str
) -> FileResponse:
    assets = MotionAssets(session, owner_user_id)
    try:
        row = await assets.asset(project_id, asset_id)
    except MotionNotFound as exc:
        raise _error(exc) from None
    return FileResponse(
        assets.storage.path_for(row), media_type=row.mime_type, content_disposition_type="inline"
    )


@router.get("/projects/{project_id}/preview/frame", responses={200: {"content": {"image/png": {}}}})
async def exact_frame(
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
        assets = await MotionAssets(session, owner_user_id).paths(project_id)
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
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: ExportCreateIn
) -> ExportOut:
    try:
        return await MotionExports(session, owner_user_id).create(project_id, body)
    except (MotionNotFound, MotionInvalid) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/exports", response_model=ExportListOut)
async def list_exports(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> ExportListOut:
    try:
        return await MotionExports(session, owner_user_id).list(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/exports/{task_id}", response_model=ExportOut)
async def get_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> ExportOut:
    try:
        return await MotionExports(session, owner_user_id).get(project_id, task_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/exports/{task_id}/cancel", response_model=ExportOut)
async def cancel_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> ExportOut:
    try:
        return await MotionExports(session, owner_user_id).cancel(project_id, task_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/exports/{task_id}/download/{format_name}")
async def download_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str, format_name: str
) -> FileResponse:
    try:
        path, filename = await MotionExports(session, owner_user_id).download(
            project_id, task_id, format_name
        )
    except MotionNotFound as exc:
        raise _error(exc) from None
    return FileResponse(path, filename=filename)


@router.post(
    "/projects/{project_id}/exports/{task_id}/video-editor-handoffs", response_model=HandoffOut
)
async def send_to_video_editor(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str, body: HandoffIn
) -> HandoffOut:
    try:
        return await MotionExports(session, owner_user_id).handoff(project_id, task_id, body)
    except (MotionNotFound, MotionInvalid) as exc:
        raise _error(exc) from None
