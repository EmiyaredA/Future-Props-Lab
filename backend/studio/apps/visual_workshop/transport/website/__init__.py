from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask

from app.capabilities.asset_store import (
    AssetError,
    AssetStorage,
    ProjectFolderError,
    ProjectSnapshotError,
    VisualAssets,
    open_project_folder,
)
from app.capabilities.asset_store.schemas.files import (
    VisualAssetImportIn,
    VisualAssetListOut,
    VisualAssetOut,
    VisualAssetReferenceCreateIn,
    VisualAssetReferencePatchIn,
)
from app.deps import OwnerDep, SessionDep, StudioAuth
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError
from studio.apps.visual_workshop.canvas import VisualCanvasDocuments, VisualCanvasError
from studio.apps.visual_workshop.operations import apply_operations as visual_operations
from studio.apps.visual_workshop.schemas.operations import VisualOperationsIn
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
    VisualProjectSnapshotImportOut,
    VisualWorkshopProjectCreateIn,
    VisualWorkshopProjectListOut,
    VisualWorkshopProjectOut,
    VisualWorkshopProjectPatchIn,
)
from studio.apps.visual_workshop.website.projects import (
    VisualWorkshopProjectNotFoundError,
    VisualWorkshopProjects,
)
from studio.apps.visual_workshop.website.snapshots import VisualWorkshopProjectSnapshots
from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut

router = APIRouter(prefix="/visual-workshop/projects", tags=["visual-workshop"])


def _not_found(exc: VisualWorkshopProjectNotFoundError) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


def _asset_error(exc: AssetError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


def _canvas_error(exc: VisualCanvasError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


def _project_file_error(exc: ProjectSnapshotError | ProjectFolderError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("", response_model=VisualWorkshopProjectListOut)
async def list_projects(
    session: SessionDep, owner_user_id: OwnerDep
) -> VisualWorkshopProjectListOut:
    return await VisualWorkshopProjects(session, owner_user_id).list()


@router.post("", response_model=VisualWorkshopProjectOut)
async def create_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: VisualWorkshopProjectCreateIn,
) -> VisualWorkshopProjectOut:
    return await VisualWorkshopProjects(session, owner_user_id).create(body)


@router.post("/snapshot-imports", response_model=VisualProjectSnapshotImportOut)
async def import_project_snapshot(
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
) -> VisualProjectSnapshotImportOut:
    try:
        return await VisualWorkshopProjectSnapshots(
            session, get_settings(), owner_user_id
        ).import_snapshot(file)
    except ProjectSnapshotError as exc:
        raise _project_file_error(exc) from None


@router.get("/{project_id}", response_model=VisualWorkshopProjectOut)
async def get_project(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VisualWorkshopProjectOut:
    try:
        return await VisualWorkshopProjects(session, owner_user_id).get(project_id)
    except VisualWorkshopProjectNotFoundError as exc:
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
        exported = await VisualWorkshopProjectSnapshots(
            session, get_settings(), owner_user_id
        ).export(project_id)
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
        await VisualWorkshopProjects(session, owner_user_id).get(project_id)
        await open_project_folder(
            AssetStorage(get_settings()),
            "visual-workshop",
            project_id,
            owner_user_id=owner_user_id,
        )
    except VisualWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except ProjectFolderError as exc:
        raise _project_file_error(exc) from None
    return ProjectFolderOpenOut()


@router.get("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def get_canvas(session: SessionDep, project_id: str) -> VisualCanvasDocumentOut:
    try:
        return await VisualCanvasDocuments(session).get(project_id)
    except VisualCanvasError as exc:
        raise _canvas_error(exc) from None


@router.put("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def put_canvas(
    session: SessionDep,
    project_id: str,
    body: VisualCanvasDocumentPutIn,
) -> VisualCanvasDocumentOut:
    try:
        return await VisualCanvasDocuments(session).put(project_id, body)
    except VisualCanvasError as exc:
        raise _canvas_error(exc) from None


@router.post("/{project_id}/canvas/operations", response_model=VisualCanvasDocumentOut)
async def apply_canvas_operations(
    project_id: str, body: VisualOperationsIn, session: SessionDep, owner_user_id: OwnerDep
):
    try:
        return await visual_operations(session, owner_user_id, project_id, body)
    except (OperationError, VisualCanvasError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None


@router.patch("/{project_id}", response_model=VisualWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualWorkshopProjectPatchIn,
) -> VisualWorkshopProjectOut:
    try:
        return await VisualWorkshopProjects(session, owner_user_id).patch(project_id, body)
    except VisualWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VisualWorkshopProjects(session, owner_user_id).delete(project_id, expected_revision)
    except VisualWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    return {"deleted": True}


@router.post("/{project_id}/asset-references", response_model=VisualAssetOut)
async def create_asset_reference(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualAssetReferenceCreateIn,
) -> VisualAssetOut:
    try:
        return await VisualAssets(session, get_settings(), owner_user_id).create_reference(
            project_id, body
        )
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post("/{project_id}/asset-imports", response_model=VisualAssetListOut)
async def import_assets(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualAssetImportIn,
) -> VisualAssetListOut:
    try:
        return await VisualAssets(session, get_settings(), owner_user_id).import_assets(
            project_id, body
        )
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/asset-references/{reference_id}", response_model=VisualAssetOut)
async def patch_asset_reference(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    reference_id: str,
    body: VisualAssetReferencePatchIn,
) -> VisualAssetOut:
    try:
        return await VisualAssets(session, get_settings(), owner_user_id).patch_reference(
            project_id, reference_id, body
        )
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.delete("/{project_id}/asset-references/{reference_id}")
async def delete_asset_reference(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    reference_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VisualAssets(session, get_settings(), owner_user_id).delete_reference(
            project_id, reference_id, expected_revision
        )
    except AssetError as exc:
        raise _asset_error(exc) from None
    return {"deleted": True}
