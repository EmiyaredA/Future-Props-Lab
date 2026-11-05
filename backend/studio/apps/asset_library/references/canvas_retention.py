"""Resolve the scope of prospective Visual canvas pins in the Assets write transaction."""

from sqlalchemy import select

from app.capabilities.asset_store.asset_scope import is_library_asset, is_visual_project_asset
from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.storage.service_models import (
    AssetReferencePin,
    PreparedAssetPin,
    ReferenceIntent,
    VisualProjectFileLink,
)


async def canvas_files(session, reference_set, change):
    candidates = list(
        await session.scalars(select(VisualAsset).where(VisualAsset.id.in_(change.asset_ids)))
    )
    links = set(
        await session.scalars(
            select(VisualProjectFileLink.asset_id).where(
                VisualProjectFileLink.project_id == change.resource_id,
                VisualProjectFileLink.asset_id.in_(change.asset_ids),
            )
        )
    )
    carried = set(change.carried_asset_ids)
    inherited = set()
    if carried:
        inherited.update(
            await session.scalars(
                select(AssetReferencePin.asset_id).where(
                    AssetReferencePin.reference_set_id == reference_set.id,
                    AssetReferencePin.asset_id.in_(carried),
                )
            )
        )
        # The predecessor may have committed its Canvas before settling its
        # remote pin. Keep those exact carried references protected as well.
        inherited.update(
            await session.scalars(
                select(PreparedAssetPin.asset_id)
                .join(ReferenceIntent, ReferenceIntent.id == PreparedAssetPin.intent_id)
                .where(
                    ReferenceIntent.reference_set_id == reference_set.id,
                    ReferenceIntent.state == "prepared",
                    ReferenceIntent.expected_resource_revision < change.expected_resource_revision,
                    PreparedAssetPin.asset_id.in_(carried),
                )
            )
        )
    allowed = {
        asset.id
        for asset in candidates
        if is_visual_project_asset(asset, change.resource_id)
        or is_library_asset(asset)
        and asset.id in links | inherited
    }
    return allowed, {asset.id for asset in candidates}
