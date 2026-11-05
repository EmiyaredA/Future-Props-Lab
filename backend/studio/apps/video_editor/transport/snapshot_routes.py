"""Portable Video project archive routes."""

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.capabilities.asset_store.project_snapshots import ProjectSnapshotError
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorUnavailableError
from studio.apps.video_editor.schemas import VideoEditorProjectSnapshotImportOut
from studio.apps.video_editor.snapshot_exports import SnapshotExports
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.get(
    "/projects/{project_id}/snapshot",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_project_snapshot(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
) -> FileResponse:
    slots = request.app.state.snapshot_slots
    if slots.locked():
        raise HTTPException(429, "video_snapshot_busy")
    try:
        async with slots:
            exported = await SnapshotExports(request, session, owner_user_id).snapshot(project_id)
    except (VideoEditorNotFoundError, VideoEditorUnavailableError) as exc:
        raise _error(exc) from None
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except (TypeError, ValueError, KeyError, OSError):
        raise _error(VideoEditorUnavailableError("项目快照暂不可用")) from None
    return FileResponse(
        exported.path,
        media_type="application/zip",
        filename=exported.filename,
        background=BackgroundTask(exported.path.unlink, missing_ok=True),
    )


@router.post("/projects/snapshot-imports", response_model=VideoEditorProjectSnapshotImportOut)
async def import_project_snapshot(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
) -> VideoEditorProjectSnapshotImportOut:
    try:
        imports = request.app.state.video_snapshot_imports
        if imports is None:
            raise ProjectSnapshotError("剪辑工程包导入暂不可用", status=503)
        return await imports.run(session, owner_user_id, file, request.state.service_assertion)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    finally:
        await file.close()
