from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile

from studio.apps.galgame_workshop.assets.assets import GalgameProjectAssets
from studio.apps.galgame_workshop.assets.maintenance import GalgameMaintenance
from studio.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from studio.apps.galgame_workshop.schemas import (
    GalgameAssetBatchUploadOut,
    GalgameAssetCategory,
    GalgameAssetImportPreviewIn,
    GalgameAssetImportPreviewOut,
    GalgameAssetOverviewOut,
    GalgameMissingAssetRepairIn,
    GalgamePackageManifestOut,
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
    GalgameProjectAssetPatchIn,
    GalgameStoryDocumentOut,
)
from studio.apps.galgame_workshop.transport.website._shared import (
    _asset_error,
    _invalid_story,
    _not_found,
)
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.contracts.asset_library.errors import AssetError

router = APIRouter()


def _assets(request: Request, session: SessionDep, owner_user_id: str) -> GalgameProjectAssets:
    return GalgameProjectAssets(session, request.app.state.settings, owner_user_id)


@router.get("/{project_id}/assets", response_model=GalgameProjectAssetListOut)
async def list_project_assets(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    query: str = Query(default="", max_length=255),
) -> GalgameProjectAssetListOut:
    try:
        return await _assets(request, session, owner_user_id).list(project_id, query=query.strip())
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/assets/overview", response_model=GalgameAssetOverviewOut)
async def get_project_asset_overview(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> GalgameAssetOverviewOut:
    try:
        return await _assets(request, session, owner_user_id).overview(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.post("/{project_id}/assets/import-preview", response_model=GalgameAssetImportPreviewOut)
async def preview_project_asset_import(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameAssetImportPreviewIn,
) -> GalgameAssetImportPreviewOut:
    try:
        return await _assets(request, session, owner_user_id).import_preview(
            project_id, body.filenames, body.category
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.post("/{project_id}/assets/batch", response_model=GalgameAssetBatchUploadOut)
async def batch_upload_project_assets(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    uploads: Annotated[list[UploadFile], File()],
    category: Annotated[GalgameAssetCategory, Form()],
) -> GalgameAssetBatchUploadOut:
    try:
        return await _assets(request, session, owner_user_id).batch_upload(
            project_id, uploads, category
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post("/{project_id}/assets/metadata-scan", response_model=GalgameProjectAssetListOut)
async def scan_project_asset_metadata(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> GalgameProjectAssetListOut:
    try:
        return await _assets(request, session, owner_user_id).scan_metadata(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/assets/package-manifest", response_model=GalgamePackageManifestOut)
async def get_project_package_manifest(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> GalgamePackageManifestOut:
    try:
        return await _assets(request, session, owner_user_id).package_manifest(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.patch("/{project_id}/assets/{asset_id}", response_model=GalgameProjectAssetOut)
async def patch_project_asset(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    body: GalgameProjectAssetPatchIn,
) -> GalgameProjectAssetOut:
    try:
        return await _assets(request, session, owner_user_id).patch(project_id, asset_id, body)
    except (GalgameWorkshopProjectNotFoundError, AssetError) as exc:
        if isinstance(exc, GalgameWorkshopProjectNotFoundError):
            raise _not_found(exc) from None
        raise _asset_error(exc) from None


@router.post("/{project_id}/assets/repair", response_model=GalgameStoryDocumentOut)
async def repair_project_asset(
    session: SessionDep,
    project_id: str,
    body: GalgameMissingAssetRepairIn,
) -> GalgameStoryDocumentOut:
    try:
        return await GalgameMaintenance(session).repair_missing(project_id, body)
    except (GalgameWorkshopProjectNotFoundError, GalgameStoryDocumentNotFoundError) as exc:
        raise _not_found(exc) from None
    except (AssetError, GalgameStoryDocumentInvalidError) as exc:
        if isinstance(exc, AssetError):
            raise _asset_error(exc) from None
        raise _invalid_story(exc) from None


@router.post("/{project_id}/assets", response_model=GalgameProjectAssetOut)
async def upload_project_asset(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
    category: Annotated[GalgameAssetCategory | None, Form()] = None,
) -> GalgameProjectAssetOut:
    try:
        return await _assets(request, session, owner_user_id).upload(
            project_id, upload, category=category
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.delete("/{project_id}/assets/{asset_id}")
async def delete_project_asset(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _assets(request, session, owner_user_id).delete(
            project_id, asset_id, expected_revision
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise HTTPException(
            exc.status,
            {"code": exc.code, "message": str(exc), **exc.detail},
        ) from None
    return {"deleted": True}
