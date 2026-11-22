"""Owner-bound reverse explicit card associations; no content or title inference."""

from pydantic import BaseModel, Field
from sqlalchemy import select

from studio.apps.visual_workshop.storage.models import (
    VisualAssetCard,
    VisualCanvasDocument,
    VisualWorkshopProject,
)


class AssetCardLinksIn(BaseModel):
    asset_ids: list[str] = Field(min_length=1, max_length=500)


class AssetCardLink(BaseModel):
    asset_id: str
    card_ids: list[str]


class AssetCardLinksOut(BaseModel):
    items: list[AssetCardLink]


async def explicit_card_links(session, owner, ids):
    wanted = set(ids)
    cards = list(
        await session.scalars(select(VisualAssetCard).where(VisualAssetCard.owner_user_id == owner))
    )
    known = {card.id for card in cards}
    result = {identity: set() for identity in wanted}
    for card in cards:
        if card.data.get("adopted_asset_id") in wanted:
            result[card.data["adopted_asset_id"]].add(card.id)
    documents = await session.scalars(
        select(VisualCanvasDocument)
        .join(VisualWorkshopProject)
        .where(VisualWorkshopProject.owner_user_id == owner)
    )
    for document in documents:
        for node in document.nodes:
            if node.get("asset_id") in wanted and node.get("design_card_id") in known:
                result[node["asset_id"]].add(node["design_card_id"])
            for ref in (node.get("generation_draft") or {}).get("design_references", []):
                if ref.get("asset_id") in wanted and ref.get("card_id") in known:
                    result[ref["asset_id"]].add(ref["card_id"])
    return AssetCardLinksOut(
        items=[
            AssetCardLink(asset_id=identity, card_ids=sorted(result[identity]))
            for identity in sorted(result)
        ]
    )
