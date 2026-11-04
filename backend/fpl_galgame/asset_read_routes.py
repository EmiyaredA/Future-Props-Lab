"""Published scoped Galgame asset catalog and manifest routes."""

from fastapi import APIRouter, Query, Request

from app.apps.galgame_workshop.schemas import (
    GalgameAssetImportPreviewIn,
    GalgameAssetImportPreviewOut,
    GalgameAssetOverviewOut,
    GalgamePackageManifestOut,
    GalgameProjectAssetListOut,
    GalgameStoryRouteReportOut,
)
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .asset_scan import scan_metadata
from .assets_read import ProjectAssetReads

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
