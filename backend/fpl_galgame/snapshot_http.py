"""Published portable Galgame project snapshot endpoints."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.capabilities.asset_store.project_snapshots import ProjectSnapshotError
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .asset_read_routes import read_assets
from .snapshot_exports import SnapshotExports

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
