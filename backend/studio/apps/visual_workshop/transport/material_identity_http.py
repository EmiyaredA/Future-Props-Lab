"""Read-only, account-scoped associations and cleanup inventory."""

from fastapi import APIRouter

from studio.apps.visual_workshop.storage.asset_card_links import (
    AssetCardLinksIn,
    AssetCardLinksOut,
    explicit_card_links,
)
from studio.apps.visual_workshop.storage.material_usage import MaterialUsageOut, material_usage
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.post("/asset-card-links", response_model=AssetCardLinksOut)
async def inspect_visual_asset_card_links(
    session: SessionDep, owner: OwnerDep, body: AssetCardLinksIn
):
    return await explicit_card_links(session, owner, body.asset_ids)


@router.get("/material-usage", response_model=MaterialUsageOut)
async def get_visual_material_usage(session: SessionDep, owner: OwnerDep):
    return await material_usage(session, owner)
