"""Fence Galgame deletion while protecting other consumers of its originals."""

from sqlalchemy import select

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import (
    AssetReferencePin,
    GalgameUploadStage,
    PreparedAssetPin,
    VisualProjectFileLink,
)
from studio.contracts.asset_library.errors import AssetError


async def prepare_project_removal(session, projection):
    uploading = await session.scalar(
        select(GalgameUploadStage.request_id)
        .where(
            GalgameUploadStage.project_id == projection.resource_id,
            GalgameUploadStage.state == "open",
        )
        .limit(1)
    )
    if uploading is not None:
        raise AssetError("项目素材尚未确认", code="project_upload_pending", status=409)
    assets = select(VisualAsset.id).where(
        VisualAsset.owner_user_id == projection.owner_user_id,
        VisualAsset.galgame_project_id == projection.resource_id,
    )
    uses = (
        select(AssetReferencePin.asset_id).where(
            AssetReferencePin.asset_id.in_(assets),
            AssetReferencePin.reference_set_id != projection.id,
        ),
        select(PreparedAssetPin.asset_id).where(PreparedAssetPin.asset_id.in_(assets)),
        select(VisualProjectFileLink.asset_id).where(VisualProjectFileLink.asset_id.in_(assets)),
    )
    for use in uses:
        if await session.scalar(use.limit(1)) is not None:
            raise AssetError("项目原件仍被其他业务引用", code="asset_in_use", status=409)
