from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.galgame_workshop.schemas import (
    GalgameMissingAssetRepairIn,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
)
from studio.apps.galgame_workshop.story.asset_repair import replace_story_file
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.contracts.asset_library.errors import AssetError


class GalgameMaintenance:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def repair_missing(
        self,
        project_id: str,
        body: GalgameMissingAssetRepairIn,
    ) -> GalgameStoryDocumentOut:
        documents = GalgameStoryDocuments(self.session)
        story = await documents.get(project_id)
        replacement = await self.session.get(VisualAsset, body.replacement_file_id)
        if replacement is None or replacement.galgame_project_id not in {None, project_id}:
            raise AssetError("替换文件不存在或不属于当前工程", code="not_found", status=404)
        payload = replace_story_file(story.document, body.story_asset_id, replacement)
        return await documents.put(
            project_id,
            GalgameStoryDocumentPutIn.model_validate(
                {
                    "expected_revision": body.expected_story_revision,
                    "document": payload,
                }
            ),
        )
