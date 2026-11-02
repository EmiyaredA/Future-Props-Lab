"""Existing Visual file-placement URLs are implemented by the Assets owner."""

from fastapi import APIRouter, Query, Request

from app.capabilities.asset_store.schemas.files import (
    VisualAssetImportIn,
    VisualAssetListOut,
    VisualAssetOut,
    VisualAssetReferenceCreateIn,
    VisualAssetReferencePatchIn,
)
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from ..project_links import ProjectFileLinks
from .context import cases

router = APIRouter(prefix="/visual-workshop/projects", tags=["visual-workshop"])


@router.post("/{project_id}/asset-references", response_model=VisualAssetOut)
async def create_asset_reference(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualAssetReferenceCreateIn,
) -> VisualAssetOut:
    return await ProjectFileLinks(cases(request, session, owner_user_id)).create(project_id, body)


@router.post("/{project_id}/asset-imports", response_model=VisualAssetListOut)
async def import_assets(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualAssetImportIn,
) -> VisualAssetListOut:
    return await ProjectFileLinks(cases(request, session, owner_user_id)).import_assets(
        project_id, body
    )


@router.patch("/{project_id}/asset-references/{reference_id}", response_model=VisualAssetOut)
async def patch_asset_reference(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    reference_id: str,
    body: VisualAssetReferencePatchIn,
) -> VisualAssetOut:
    return await ProjectFileLinks(cases(request, session, owner_user_id)).patch(
        project_id,
        reference_id,
        body,
    )


@router.delete("/{project_id}/asset-references/{reference_id}")
async def delete_asset_reference(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    reference_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    await ProjectFileLinks(cases(request, session, owner_user_id)).delete(
        project_id,
        reference_id,
        expected_revision,
    )
    return {"deleted": True}
