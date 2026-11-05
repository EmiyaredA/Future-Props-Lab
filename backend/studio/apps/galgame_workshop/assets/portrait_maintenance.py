from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import AssetError
from studio.apps.galgame_workshop.schemas import (
    GalgamePortraitUpgradeApplyIn,
    GalgamePortraitUpgradePreviewOut,
    GalgameStoryDocumentPutIn,
    GalgameStorySnapshotOut,
    GalgameStorySnapshotRestoreIn,
)
from studio.apps.galgame_workshop.storage.models import GalgameStorySnapshot
from studio.apps.galgame_workshop.story.portrait_values import (
    preview_portraits,
    upgraded_portrait_values,
)
from studio.apps.galgame_workshop.story.snapshots import list_snapshots
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.runtime.revisions import RevisionConflictError


class GalgamePortraitMaintenance:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def preview(self, project_id: str) -> GalgamePortraitUpgradePreviewOut:
        story = await GalgameStoryDocuments(self.session).get(project_id)
        return await preview_portraits(self.session, story)

    async def apply(self, project_id: str, body: GalgamePortraitUpgradeApplyIn) -> object:
        story = await GalgameStoryDocuments(self.session).get(project_id)
        if story.revision != body.expected_story_revision:
            raise RevisionConflictError(
                body.expected_story_revision,
                story.revision,
                story.model_dump(mode="json", by_alias=True),
            )
        preview = await self.preview(project_id)
        payload = upgraded_portrait_values(story.document, preview)
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
        return await list_snapshots(self.session, project_id)

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
