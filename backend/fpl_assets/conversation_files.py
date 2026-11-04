"""Return only exact attachment metadata in an owned conversation projection."""

from sqlalchemy import or_, select

from app.capabilities.asset_store.models import VisualAsset

from .models import AssetReferencePin, AssetReferenceSet, PreparedAssetPin, ReferenceIntent


async def attachments(session, project_id, conversation_id, asset_ids):
    owner = session.info["owner_user_id"]
    projection = select(AssetReferenceSet.id).where(
        AssetReferenceSet.owner_user_id == owner,
        AssetReferenceSet.service_id == "visual",
        AssetReferenceSet.resource_kind == "conversation",
        AssetReferenceSet.resource_id == conversation_id,
        AssetReferenceSet.deleted.is_(False),
    )
    committed = select(AssetReferencePin.asset_id).where(
        AssetReferencePin.reference_set_id.in_(projection)
    )
    pending = (
        select(PreparedAssetPin.asset_id)
        .join(ReferenceIntent, ReferenceIntent.id == PreparedAssetPin.intent_id)
        .where(
            ReferenceIntent.reference_set_id.in_(projection),
            ReferenceIntent.state == "prepared",
        )
    )
    return list(
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.id.in_(asset_ids),
                VisualAsset.id.in_(committed.union(pending)),
                or_(
                    VisualAsset.project_id == project_id,
                    VisualAsset.project_id.is_(None)
                    & VisualAsset.galgame_project_id.is_(None)
                    & VisualAsset.video_editor_project_id.is_(None)
                    & VisualAsset.motion_compositor_project_id.is_(None),
                ),
            )
            .order_by(VisualAsset.id)
        )
    )
