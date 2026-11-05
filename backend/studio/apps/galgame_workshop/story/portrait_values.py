"""Portrait height projection and Story edits shared by both applications."""

from sqlalchemy import select

from studio.apps.galgame_workshop.schemas import (
    GalgamePortraitUpgradeItem,
    GalgamePortraitUpgradePreviewOut,
)
from studio.apps.galgame_workshop.storage.models import GalgameAssetMetadata


async def preview_portraits(session, story):
    assets_by_id = {asset.id: asset for asset in story.document.assets}
    file_ids = {
        asset.file_id
        for asset in story.document.assets
        if asset.type == "image" and asset.role == "characterPortrait"
    }
    metadata_by_file = {
        row.asset_id: row
        for row in (
            (
                await session.execute(
                    select(GalgameAssetMetadata).where(
                        GalgameAssetMetadata.asset_id.in_(file_ids),
                        GalgameAssetMetadata.project_id == story.project_id,
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    canvas_height = story.document.settings.canvas.height
    items: list[GalgamePortraitUpgradeItem] = []
    for character in story.document.characters:
        for expression in character.expressions:
            story_asset = assets_by_id.get(expression.asset_id)
            metadata = metadata_by_file.get(story_asset.file_id) if story_asset else None
            target = (
                round(metadata.height / canvas_height * 100, 4)
                if metadata is not None and metadata.height
                else None
            )
            items.append(
                GalgamePortraitUpgradeItem(
                    characterId=character.id,
                    expressionId=expression.id,
                    currentHeightPercent=expression.height_percent,
                    targetHeightPercent=target,
                    status="ready" if target is not None else "missing_metadata",
                )
            )
    return GalgamePortraitUpgradePreviewOut(
        storyRevision=story.revision,
        items=items,
    )


def upgraded_portrait_values(document, preview):
    targets = {
        (item.character_id, item.expression_id): item.target_height_percent
        for item in preview.items
        if item.status == "ready"
    }
    payload = document.model_dump(mode="json", by_alias=True)
    for character in payload["characters"]:
        for expression in character["expressions"]:
            target = targets.get((character["id"], expression["id"]))
            if target is not None:
                expression["heightPercent"] = target
    return payload
