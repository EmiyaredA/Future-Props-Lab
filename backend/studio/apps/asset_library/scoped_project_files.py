"""Fence file writes while their account-owned project is being deleted."""

from sqlalchemy import delete, select

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.references.references import check_removal_fence, protect_references
from studio.apps.asset_library.storage.service_models import AssetReferenceSet, ReferenceIntent
from studio.contracts.asset_library.errors import AssetError

from .deletions import schedule

PROJECT_FILE_COLUMNS = {
    "visual": VisualAsset.project_id,
    "motion": VisualAsset.motion_compositor_project_id,
    "video": VisualAsset.video_editor_project_id,
    "galgame": VisualAsset.galgame_project_id,
}


async def files_for_removal(session, service, project_id):
    files = list(
        await session.scalars(
            select(VisualAsset).where(PROJECT_FILE_COLUMNS[service] == project_id)
        )
    )
    await protect_references(session, [row.id for row in files])
    return files


async def remove_files(session, service, project_id):
    files = await files_for_removal(session, service, project_id)
    schedule(session, files)
    await session.execute(delete(VisualAsset).where(VisualAsset.id.in_([row.id for row in files])))


async def check_writable(session, service, project_id):
    projection = await session.scalar(
        select(AssetReferenceSet).where(
            AssetReferenceSet.service_id == service,
            AssetReferenceSet.resource_kind == "project",
            AssetReferenceSet.resource_id == project_id,
        )
    )
    if projection is None:
        raise AssetError("项目文件范围尚未核验", code=f"{service}_project_unverified", status=503)
    name = "特效项目" if service == "motion" else "剪辑项目"
    if projection.deleted:
        raise AssetError(f"{name}已删除", code="not_found", status=404)
    pending = await session.scalar(
        select(ReferenceIntent.id)
        .where(
            ReferenceIntent.reference_set_id == projection.id,
            ReferenceIntent.state == "prepared",
            ReferenceIntent.expected_resource_revision >= 0,
        )
        .limit(1)
    )
    if pending is not None:
        raise AssetError(f"{name}正在删除", code=f"{service}_project_deletion_pending", status=409)


DOCUMENTS = {"visual": "canvas", "galgame": "story"}


async def check_project_scope(session, service, project_id):
    if service == "video":
        await check_writable(session, service, project_id)
        return
    projection = await session.scalar(
        select(AssetReferenceSet).where(
            AssetReferenceSet.service_id == service,
            AssetReferenceSet.resource_kind == DOCUMENTS[service],
            AssetReferenceSet.resource_id == project_id,
        )
    )
    if projection is None:
        raise AssetError("项目文件范围尚未核验", code="project_scope_unverified", status=503)
    if projection.deleted:
        raise AssetError("项目已删除", code="not_found", status=404)
    await check_removal_fence(session, projection.id, service)
