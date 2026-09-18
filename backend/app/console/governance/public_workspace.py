from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.storage import AssetStorage
from app.console.governance.service import AccountError
from app.models import (
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
    VisualAsset,
    VisualProjectAssetReference,
    Workspace,
)
from app.orm import PUBLIC_WORKSPACE_PROJECT_MODELS
from app.runtime.config import get_settings


async def require_public_workspace(session: AsyncSession, workspace_id: str) -> Workspace:
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None or workspace.visibility != "public":
        raise AccountError("public_workspace_not_found")
    return workspace


def asset_view(asset: VisualAsset) -> dict:
    return {
        "id": asset.id,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
        "preview_url": f"/v1/public-workspace/assets/{asset.id}/content",
    }


async def public_projection(session: AsyncSession, workspace_id: str) -> dict:
    workspace = await require_public_workspace(session, workspace_id)
    VisualWorkshopProject = PUBLIC_WORKSPACE_PROJECT_MODELS["visual"]
    visual_projects = list(
        (
            await session.execute(
                select(VisualWorkshopProject)
                .where(VisualWorkshopProject.workspace_id == workspace_id)
                .order_by(VisualWorkshopProject.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    galgame_projects = list(
        (
            await session.execute(
                select(GalgameWorkshopProject)
                .where(GalgameWorkshopProject.workspace_id == workspace_id)
                .order_by(GalgameWorkshopProject.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    visual_items = []
    for project in visual_projects:
        assets = list(
            (
                await session.execute(
                    select(VisualAsset)
                    .outerjoin(
                        VisualProjectAssetReference,
                        VisualProjectAssetReference.asset_id == VisualAsset.id,
                    )
                    .where(
                        VisualAsset.workspace_id == workspace_id,
                        or_(
                            VisualAsset.project_id == project.id,
                            VisualProjectAssetReference.project_id == project.id,
                        ),
                    )
                    .order_by(VisualAsset.updated_at.desc())
                )
            )
            .scalars()
            .unique()
            .all()
        )
        visual_items.append(
            {
                "id": project.id,
                "title": project.title,
                "is_official": project.is_official,
                "kind": project.kind,
                "status": project.status,
                "updated_at": project.updated_at,
                "assets": [asset_view(asset) for asset in assets],
            }
        )
    galgame_items = []
    for project in galgame_projects:
        assets = list(
            (
                await session.execute(
                    select(VisualAsset)
                    .outerjoin(
                        GalgameProjectAssetReference,
                        GalgameProjectAssetReference.asset_id == VisualAsset.id,
                    )
                    .where(
                        VisualAsset.workspace_id == workspace_id,
                        or_(
                            VisualAsset.galgame_project_id == project.id,
                            GalgameProjectAssetReference.project_id == project.id,
                        ),
                    )
                    .order_by(VisualAsset.updated_at.desc())
                )
            )
            .scalars()
            .unique()
            .all()
        )
        galgame_items.append(
            {
                "id": project.id,
                "title": project.title,
                "is_official": project.is_official,
                "status": project.status,
                "updated_at": project.updated_at,
                "assets": [asset_view(asset) for asset in assets],
            }
        )
    return {
        "workspace_id": workspace.id,
        "workspace_name": workspace.name,
        "visual_projects": visual_items,
        "galgame_projects": galgame_items,
    }


async def public_story(
    session: AsyncSession, *, workspace_id: str, project_id: str
) -> GalgameStoryDocument:
    await require_public_workspace(session, workspace_id)
    project = await session.scalar(
        select(GalgameWorkshopProject).where(
            GalgameWorkshopProject.id == project_id,
            GalgameWorkshopProject.workspace_id == workspace_id,
        )
    )
    if project is None:
        raise AccountError("public_project_not_found")
    story = await session.get(GalgameStoryDocument, project_id)
    if story is None:
        raise AccountError("public_project_not_found")
    return story


async def public_asset_content(session: AsyncSession, *, workspace_id: str, asset_id: str):
    await require_public_workspace(session, workspace_id)
    asset = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id, VisualAsset.workspace_id == workspace_id
        )
    )
    if asset is None:
        raise AccountError("public_asset_not_found")
    reachable = bool(asset.project_id or asset.galgame_project_id)
    if not reachable:
        reachable = bool(
            await session.scalar(
                select(VisualProjectAssetReference.id).where(
                    VisualProjectAssetReference.asset_id == asset.id,
                    VisualProjectAssetReference.workspace_id == workspace_id,
                )
            )
            or await session.scalar(
                select(GalgameProjectAssetReference.id)
                .join(
                    GalgameWorkshopProject,
                    GalgameWorkshopProject.id == GalgameProjectAssetReference.project_id,
                )
                .where(
                    GalgameProjectAssetReference.asset_id == asset.id,
                    GalgameWorkshopProject.workspace_id == workspace_id,
                )
            )
        )
    if not reachable:
        raise AccountError("public_asset_not_found")
    path = AssetStorage(get_settings()).path_for(asset)
    if not path.is_file():
        raise AccountError("public_asset_not_found")
    return asset, path
