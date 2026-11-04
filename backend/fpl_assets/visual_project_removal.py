"""Delete project-owned folders and originals after the Visual source commits."""

from sqlalchemy import delete, select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset, VisualAssetFolder

from .models import (
    AssetReferencePin,
    AssetReferenceSet,
    PreparedAssetPin,
    ReferenceIntent,
    VisualProjectFileLink,
)
from .scoped_project_files import remove_files


def conversations(projection, identities):
    return select(AssetReferenceSet.id).where(
        AssetReferenceSet.owner_user_id == projection.owner_user_id,
        AssetReferenceSet.service_id == "visual",
        AssetReferenceSet.resource_kind == "conversation",
        AssetReferenceSet.resource_id.in_(identities),
        AssetReferenceSet.deleted.is_(False),
    )


async def prepare(session, projection, identities):
    children = conversations(projection, identities)
    if (
        await session.scalar(
            select(ReferenceIntent.id)
            .where(
                ReferenceIntent.reference_set_id.in_(children),
                ReferenceIntent.state == "prepared",
            )
            .limit(1)
        )
        is not None
    ):
        raise AssetError("对话引用尚未结算", code="project_references_pending", status=409)
    if (
        await session.scalar(
            select(ReferenceIntent.id)
            .where(
                ReferenceIntent.reference_set_id.in_(children),
                ReferenceIntent.prepared_result["visual_conversation_project"].as_string()
                != projection.resource_id,
            )
            .limit(1)
        )
        is not None
    ):
        raise AssetError("对话不属于当前项目", code="project_conversation_scope", status=409)
    if (
        await session.scalar(
            select(AssetReferenceSet.id)
            .where(
                AssetReferenceSet.id.in_(children),
                AssetReferenceSet.scope_project_id != projection.resource_id,
            )
            .limit(1)
        )
        is not None
    ):
        raise AssetError("对话不属于当前项目", code="project_conversation_scope", status=409)
    originals = select(VisualAsset.id).where(
        VisualAsset.owner_user_id == projection.owner_user_id,
        VisualAsset.project_id == projection.resource_id,
    )
    uses = (
        select(AssetReferencePin.asset_id).where(
            AssetReferencePin.asset_id.in_(originals),
            AssetReferencePin.reference_set_id != projection.id,
            AssetReferencePin.reference_set_id.not_in(children),
        ),
        select(PreparedAssetPin.asset_id).where(PreparedAssetPin.asset_id.in_(originals)),
        select(VisualProjectFileLink.asset_id).where(
            VisualProjectFileLink.asset_id.in_(originals),
            VisualProjectFileLink.project_id != projection.resource_id,
        ),
    )
    for use in uses:
        if await session.scalar(use.limit(1)) is not None:
            raise AssetError("项目原件仍被其他业务引用", code="asset_in_use", status=409)


async def commit(session, projection, identities):
    for child in await session.scalars(
        select(AssetReferenceSet).where(
            AssetReferenceSet.id.in_(conversations(projection, identities))
        )
    ):
        await session.execute(
            delete(AssetReferencePin).where(AssetReferencePin.reference_set_id == child.id)
        )
        child.deleted = True
        child.revision += 1
        child.resource_revision += 1
    await session.execute(
        delete(VisualProjectFileLink).where(
            VisualProjectFileLink.owner_user_id == projection.owner_user_id,
            VisualProjectFileLink.project_id == projection.resource_id,
        )
    )
    await remove_files(session, "visual", projection.resource_id)
    await session.execute(
        delete(VisualAssetFolder).where(
            VisualAssetFolder.owner_user_id == projection.owner_user_id,
            VisualAssetFolder.project_id == projection.resource_id,
        )
    )
