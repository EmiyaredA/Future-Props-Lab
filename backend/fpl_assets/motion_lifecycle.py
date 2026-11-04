"""Serialize a Motion project deletion with publication of its Assets-owned files."""

from sqlalchemy import delete, select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset

from .deletions import schedule
from .models import AssetReferenceSet, ReferenceIntent
from .references import protect_references


async def files_for_removal(session, project_id):
    files = list(
        await session.scalars(
            select(VisualAsset).where(VisualAsset.motion_compositor_project_id == project_id)
        )
    )
    await protect_references(session, [row.id for row in files])
    return files


async def remove_files(session, project_id):
    files = await files_for_removal(session, project_id)
    schedule(session, files)
    await session.execute(delete(VisualAsset).where(VisualAsset.id.in_([row.id for row in files])))


async def check_writable(session, project_id):
    projection = await session.scalar(
        select(AssetReferenceSet).where(
            AssetReferenceSet.service_id == "motion",
            AssetReferenceSet.resource_kind == "project",
            AssetReferenceSet.resource_id == project_id,
        )
    )
    if projection is None:
        raise AssetError("项目文件范围尚未核验", code="motion_project_unverified", status=503)
    if projection.deleted:
        raise AssetError("特效项目已删除", code="not_found", status=404)
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
        raise AssetError("特效项目正在删除", code="motion_project_deletion_pending", status=409)
