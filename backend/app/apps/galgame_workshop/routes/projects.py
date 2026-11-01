from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.apps.galgame_workshop.errors import (
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from app.apps.galgame_workshop.projects import GalgameWorkshopProjects
from app.apps.galgame_workshop.routes._shared import _not_found
from app.apps.galgame_workshop.schemas import (
    GalgameProjectSnapshotImportOut,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)
from app.apps.galgame_workshop.snapshots import GalgameProjectSnapshots
from app.capabilities.asset_store import (
    AssetStorage,
    ProjectFolderError,
    ProjectSnapshotError,
    open_project_folder,
)
from app.capabilities.asset_store.schemas.project_snapshots import ProjectFolderOpenOut
from app.deps import OwnerDep, SessionDep, StudioAuth
from app.runtime.config import get_settings

router = APIRouter()


def _project_file_error(exc: ProjectSnapshotError | ProjectFolderError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(
    session: SessionDep, owner_user_id: OwnerDep
) -> GalgameWorkshopProjectListOut:
    return await GalgameWorkshopProjects(session, owner_user_id).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: GalgameWorkshopProjectCreateIn,
) -> GalgameWorkshopProjectOut:
    return await GalgameWorkshopProjects(session, owner_user_id).create(body)


@router.post("/snapshot-imports", response_model=GalgameProjectSnapshotImportOut)
async def import_project_snapshot(
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
) -> GalgameProjectSnapshotImportOut:
    try:
        return await GalgameProjectSnapshots(
            session, get_settings(), owner_user_id
        ).import_snapshot(file)
    except ProjectSnapshotError as exc:
        raise _project_file_error(exc) from None


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session, owner_user_id).get(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get(
    "/{project_id}/snapshot",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_project_snapshot(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        exported = await GalgameProjectSnapshots(session, get_settings(), owner_user_id).export(
            project_id
        )
    except ProjectSnapshotError as exc:
        raise _project_file_error(exc) from None
    return FileResponse(
        exported.path,
        media_type="application/zip",
        filename=exported.filename,
        background=BackgroundTask(exported.path.unlink, missing_ok=True),
    )


@router.post("/{project_id}/open-folder", response_model=ProjectFolderOpenOut)
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
        await GalgameWorkshopProjects(session, owner_user_id).get(project_id)
        await open_project_folder(
            AssetStorage(get_settings()),
            "galgame-workshop",
            project_id,
            owner_user_id=owner_user_id,
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except ProjectFolderError as exc:
        raise _project_file_error(exc) from None
    return ProjectFolderOpenOut()


@router.patch("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameWorkshopProjectPatchIn,
) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session, owner_user_id).patch(project_id, body)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except GalgameStoryNotReadyError as exc:
        raise HTTPException(
            422,
            {
                "code": "story_not_ready",
                "message": str(exc),
                "report": exc.report.model_dump(mode="json"),
            },
        ) from None


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await GalgameWorkshopProjects(session, owner_user_id).delete(project_id, expected_revision)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    return {"deleted": True}
