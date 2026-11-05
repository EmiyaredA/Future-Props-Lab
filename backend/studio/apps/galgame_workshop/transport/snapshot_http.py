"""Published portable Galgame project snapshot endpoints."""

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.capabilities.asset_store.project_snapshots import ProjectSnapshotError
from studio.apps.galgame_workshop.schemas import GalgameProjectSnapshotImportOut
from studio.apps.galgame_workshop.snapshots.snapshot_exports import SnapshotExports
from studio.apps.galgame_workshop.transport.asset_read_routes import read_assets
from studio.contracts.galgame_workshop.galgame_assets import SOURCE
from studio.runtime.http.dependencies import OwnerDep, SessionDep

router = APIRouter(prefix=SOURCE, tags=["galgame-workshop"])


@router.get(
    "/{project_id}/snapshot",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_project_snapshot(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        exported = await SnapshotExports(
            request, read_assets(request, session, owner_user_id)
        ).export(project_id)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return FileResponse(
        exported.path,
        media_type="application/zip",
        filename=exported.filename,
        headers={"Cache-Control": "private, no-store"},
        background=BackgroundTask(exported.path.unlink, missing_ok=True),
    )


@router.post("/snapshot-imports", response_model=GalgameProjectSnapshotImportOut)
async def import_project_snapshot(
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
    request: Request,
) -> GalgameProjectSnapshotImportOut:
    imports = request.app.state.snapshot_imports
    if imports is None:
        await file.close()
        raise HTTPException(503, "galgame_archive_authorization_unavailable")
    try:
        return await imports.run(session, owner_user_id, file, request.state.service_assertion)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
