from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import iso_utc
from app.files import AssetError
from app.galgame_workshop.story import GalgameStoryDocuments
from app.models import GalgameAssetMetadata, GalgameStorySnapshot
from app.schemas.galgame_workshop import (
    GalgamePortraitUpgradeApplyIn,
    GalgamePortraitUpgradeItem,
    GalgamePortraitUpgradePreviewOut,
    GalgameStoryDocumentPutIn,
    GalgameStorySnapshotOut,
    GalgameStorySnapshotRestoreIn,
)


class GalgamePortraitMaintenance:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def preview(self, project_id: str) -> GalgamePortraitUpgradePreviewOut:
        story = await GalgameStoryDocuments(self.session).get(project_id)
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
                    await self.session.execute(
                        select(GalgameAssetMetadata).where(
                            GalgameAssetMetadata.asset_id.in_(file_ids)
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

    async def apply(self, project_id: str, body: GalgamePortraitUpgradeApplyIn) -> object:
        story = await GalgameStoryDocuments(self.session).get(project_id)
        if story.revision != body.expected_story_revision:
            from app.concurrency.revisions import RevisionConflictError

            raise RevisionConflictError(
                body.expected_story_revision,
                story.revision,
                story.model_dump(mode="json", by_alias=True),
            )
        preview = await self.preview(project_id)
        targets = {
            (item.character_id, item.expression_id): item.target_height_percent
            for item in preview.items
            if item.status == "ready"
        }
        payload = story.document.model_dump(mode="json", by_alias=True)
        for character in payload["characters"]:
            for expression in character["expressions"]:
                target = targets.get((character["id"], expression["id"]))
                if target is not None:
                    expression["heightPercent"] = target
        self.session.add(
            GalgameStorySnapshot(
                project_id=project_id,
                story_revision=story.revision,
                reason="portrait-size-upgrade",
                document=story.document.model_dump(mode="json", by_alias=True),
            )
        )
        return await GalgameStoryDocuments(self.session).put(
            project_id,
            GalgameStoryDocumentPutIn.model_validate(
                {
                    "expected_revision": body.expected_story_revision,
                    "document": payload,
                }
            ),
        )

    async def list_snapshots(self, project_id: str) -> list[GalgameStorySnapshotOut]:
        await GalgameStoryDocuments(self.session).get(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(GalgameStorySnapshot)
                    .where(GalgameStorySnapshot.project_id == project_id)
                    .order_by(GalgameStorySnapshot.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [
            GalgameStorySnapshotOut(
                id=row.id,
                storyRevision=row.story_revision,
                reason=row.reason,
                createdAt=iso_utc(row.created_at),
            )
            for row in rows
        ]

    async def restore(
        self, project_id: str, snapshot_id: str, body: GalgameStorySnapshotRestoreIn
    ) -> object:
        snapshot = await self.session.get(GalgameStorySnapshot, snapshot_id)
        if snapshot is None or snapshot.project_id != project_id:
            raise AssetError("维护快照不存在", code="not_found", status=404)
        return await GalgameStoryDocuments(self.session).put(
            project_id,
            GalgameStoryDocumentPutIn.model_validate(
                {
                    "expected_revision": body.expected_story_revision,
                    "document": snapshot.document,
                }
            ),
        )
