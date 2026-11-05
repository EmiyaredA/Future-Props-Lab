"""Published scoped Galgame asset catalog and manifest routes."""

from fastapi import APIRouter, HTTPException, Query, Request

from studio.apps.galgame_workshop.asset_edits import AssetEdits
from studio.apps.galgame_workshop.asset_scan import scan_metadata
from studio.apps.galgame_workshop.assets_read import ProjectAssetReads
from studio.apps.galgame_workshop.schemas import (
    GalgameAssetImportPreviewIn,
    GalgameAssetImportPreviewOut,
    GalgameAssetOverviewOut,
    GalgamePackageManifestOut,
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
    GalgameProjectAssetPatchIn,
    GalgameStoryRouteReportOut,
)
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.galgame_workshop.galgame_assets import SOURCE
from studio.runtime.http.dependencies import OwnerDep, SessionDep

router = APIRouter(prefix=SOURCE, tags=["galgame-workshop"])


def read_assets(request, session, owner):
    return ProjectAssetReads(
        session,
        owner,
        request.app.state.capabilities,
        request.state.service_assertion,
        request.method,
        request.url.path,
    )


@router.get("/{project_id}/assets", response_model=GalgameProjectAssetListOut)
async def list_project_assets(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    query: str = Query(default="", max_length=255),
) -> GalgameProjectAssetListOut:
    return await read_assets(request, session, owner_user_id).list(project_id, query=query.strip())


@router.get("/{project_id}/assets/overview", response_model=GalgameAssetOverviewOut)
async def get_project_asset_overview(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
) -> GalgameAssetOverviewOut:
    return await read_assets(request, session, owner_user_id).overview(project_id)


@router.post("/{project_id}/assets/import-preview", response_model=GalgameAssetImportPreviewOut)
async def preview_project_asset_import(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameAssetImportPreviewIn,
) -> GalgameAssetImportPreviewOut:
    return await read_assets(request, session, owner_user_id).import_preview(
        project_id, body.filenames, body.category
    )


@router.get("/{project_id}/assets/package-manifest", response_model=GalgamePackageManifestOut)
async def get_project_package_manifest(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
) -> GalgamePackageManifestOut:
    return await read_assets(request, session, owner_user_id).package_manifest(project_id)


@router.get("/{project_id}/story/report", response_model=GalgameStoryRouteReportOut)
async def get_story_report(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
) -> GalgameStoryRouteReportOut:
    return await read_assets(request, session, owner_user_id).report(project_id)


@router.post("/{project_id}/assets/metadata-scan", response_model=GalgameProjectAssetListOut)
async def scan_project_asset_metadata(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    request: Request,
) -> GalgameProjectAssetListOut:
    return await scan_metadata(read_assets(request, session, owner_user_id), project_id)


@router.patch("/{project_id}/assets/{asset_id}", response_model=GalgameProjectAssetOut)
async def patch_project_asset(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    body: GalgameProjectAssetPatchIn,
    request: Request,
) -> GalgameProjectAssetOut:
    try:
        return await AssetEdits(
            request, read_assets(request, session, owner_user_id), owner_user_id
        ).patch(project_id, asset_id, body)
    except AssetError as exc:
        raise HTTPException(
            exc.status, {"code": exc.code, "message": str(exc), **exc.detail}
        ) from None


@router.delete("/{project_id}/assets/{asset_id}")
async def delete_project_asset(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    request: Request,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await AssetEdits(
            request, read_assets(request, session, owner_user_id), owner_user_id
        ).delete(project_id, asset_id, expected_revision)
    except AssetError as exc:
        raise HTTPException(
            exc.status, {"code": exc.code, "message": str(exc), **exc.detail}
        ) from None
    return {"deleted": True}
