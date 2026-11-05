"""The published Visual portable snapshot export."""

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.apps.visual_workshop.schemas.workshop import VisualProjectSnapshotImportOut
from app.capabilities.asset_store.project_snapshots import ProjectSnapshotError
from fpl_runtime.http_dependencies import OwnerDep, SessionDep
from fpl_runtime.visual_assistant import SOURCE

from .snapshot_exports import SnapshotExports

router = APIRouter(prefix=SOURCE, tags=["visual-workshop"])


@router.get(
    "/{project_id}/snapshot",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_project_snapshot(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        result = await SnapshotExports(request, session, owner_user_id).export(project_id)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return FileResponse(
        result.path,
        media_type="application/zip",
        filename=result.filename,
        headers={"Cache-Control": "private, no-store"},
        background=BackgroundTask(result.path.unlink, missing_ok=True),
    )


@router.post("/snapshot-imports", response_model=VisualProjectSnapshotImportOut)
async def import_project_snapshot(
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
    request: Request,
) -> VisualProjectSnapshotImportOut:
    imports = request.app.state.snapshot_imports
    if imports is None:
        await file.close()
        raise HTTPException(503, "visual_archive_authorization_unavailable")
    try:
        return await imports.run(session, owner_user_id, file, request.state.service_assertion)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
