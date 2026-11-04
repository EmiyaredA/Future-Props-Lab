from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.apps.galgame_workshop.models import (
    GalgameStoryDocument,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.schemas import (
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryProject,
)
from app.apps.galgame_workshop.story.asset_values import validate_story_asset_media
from app.apps.galgame_workshop.story.document_values import (
    default_story_document as default_story_document,
)
from app.apps.galgame_workshop.story.document_values import (
    normalize_story_document as normalize_story_document,
)
from app.apps.galgame_workshop.story.document_values import (
    story_out as story_out,
)
from app.apps.galgame_workshop.story.reference_index import sync_asset_references
from app.apps.galgame_workshop.story.route_report import build_route_report as build_route_report
from app.capabilities.asset_store.models import VisualAsset
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


class GalgameStoryDocuments:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        project = await self.session.get(GalgameWorkshopProject, project_id)
        if project is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        return project

    async def _row(self, project_id: str) -> GalgameStoryDocument:
        await self._project(project_id)
        row = await self.session.get(GalgameStoryDocument, project_id)
        if row is None:
            raise GalgameStoryDocumentNotFoundError("故事文档不存在")
        return row

    async def get(self, project_id: str) -> GalgameStoryDocumentOut:
        row = await self._row(project_id)
        return story_out(row, normalize_story_document(row.document))

    async def _asset_rows(
        self, project_id: str, document: GalgameStoryProject
    ) -> dict[str, VisualAsset]:
        file_ids = {asset.file_id for asset in document.assets}
        if not file_ids:
            return {}
        rows = (
            (await self.session.execute(select(VisualAsset).where(VisualAsset.id.in_(file_ids))))
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        if set(by_id) != file_ids:
            raise GalgameStoryDocumentInvalidError("故事素材引用的文件不存在")
        for asset in document.assets:
            row = by_id[asset.file_id]
            validate_story_asset_media(asset.type, row.media_kind, row.mime_type)
            if row.project_id is not None:
                raise GalgameStoryDocumentInvalidError("不能引用视觉工坊的私有素材")
            if row.galgame_project_id not in {None, project_id}:
                raise GalgameStoryDocumentInvalidError("不能引用其他 Galgame 工程的私有素材")
        return by_id

    async def put(
        self, project_id: str, body: GalgameStoryDocumentPutIn, *, commit: bool = True
    ) -> GalgameStoryDocumentOut:
        project = await self._project(project_id)
        await self._row(project_id)
        asset_rows = await self._asset_rows(project_id, body.document)
        now = utc_now()
        result = await self.session.execute(
            update(GalgameStoryDocument)
            .where(
                GalgameStoryDocument.project_id == project_id,
                GalgameStoryDocument.revision == body.expected_revision,
            )
            .values(
                document=body.document.model_dump(mode="json", by_alias=True),
                revision=body.expected_revision + 1,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                current.model_dump(mode="json", by_alias=True),
            )
        if project.status == "completed":
            project.status = "draft"
            project.revision += 1
            project.updated_at = now
        await sync_asset_references(self.session, project_id, set(asset_rows))
        if commit:
            await self.session.commit()
        return await self.get(project_id)
