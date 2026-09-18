from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.galgame_workshop.schemas import (
    GalgameMissingAssetRepairIn,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
)
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.models import VisualAsset


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
        payload = story.document.model_dump(mode="json", by_alias=True)
        target = next(
            (asset for asset in payload["assets"] if asset["id"] == body.story_asset_id),
            None,
        )
        if target is None:
            raise AssetError("故事素材不存在", code="story_asset_not_found", status=404)
        if replacement.media_kind != target["type"]:
            raise AssetError("替换文件类型与故事素材不一致", code="media_kind_mismatch")
        target["fileId"] = replacement.id
        return await documents.put(
            project_id,
            GalgameStoryDocumentPutIn.model_validate(
                {
                    "expected_revision": body.expected_story_revision,
                    "document": payload,
                }
            ),
        )
