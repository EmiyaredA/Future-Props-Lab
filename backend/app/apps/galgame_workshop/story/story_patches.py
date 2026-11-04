from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameWorkshopProject
from app.apps.galgame_workshop.schemas import (
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryEditsPatchIn,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
)
from app.apps.galgame_workshop.story.edit_values import (
    apply_dialogue,
    apply_edits,
    apply_stage_expression,
)
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now


class GalgameStoryPatches:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _rows(self, project_id: str) -> tuple[GalgameWorkshopProject, GalgameStoryDocument]:
        project = await self.session.get(GalgameWorkshopProject, project_id)
        if project is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        row = await self.session.get(GalgameStoryDocument, project_id)
        if row is None:
            raise GalgameStoryDocumentNotFoundError("故事文档不存在")
        if not isinstance(row.document, dict):
            raise GalgameStoryDocumentInvalidError("故事文档格式无效")
        return project, row

    async def _save(
        self,
        project_id: str,
        project: GalgameWorkshopProject,
        document: dict[str, Any],
        expected_revision: int,
    ) -> str:
        now = utc_now()
        result = await self.session.execute(
            update(GalgameStoryDocument)
            .where(
                GalgameStoryDocument.project_id == project_id,
                GalgameStoryDocument.revision == expected_revision,
            )
            .values(
                document=document,
                revision=expected_revision + 1,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await GalgameStoryDocuments(self.session).get(project_id)
            raise RevisionConflictError(
                expected_revision,
                latest.revision,
                latest.model_dump(mode="json", by_alias=True),
            )
        if project.status == "completed":
            project.status = "draft"
            project.revision += 1
            project.updated_at = now
        await self.session.commit()
        return iso_utc(now)

    async def patch_dialogue(
        self, project_id: str, body: GalgameStoryDialoguePatchIn
    ) -> GalgameStoryDialoguePatchOut:
        project, row = await self._rows(project_id)
        document = deepcopy(row.document)
        updated = apply_dialogue(document, body)
        updated_at = await self._save(project_id, project, document, body.expected_revision)
        return GalgameStoryDialoguePatchOut(
            project_id=project_id,
            revision=body.expected_revision + 1,
            updated_at=updated_at,
            block=updated,
        )

    async def patch_stage_expression(
        self, project_id: str, body: GalgameStoryStageExpressionPatchIn
    ) -> GalgameStoryStageExpressionPatchOut:
        project, row = await self._rows(project_id)
        document = deepcopy(row.document)
        updated = apply_stage_expression(document, body)
        updated_at = await self._save(project_id, project, document, body.expected_revision)
        return GalgameStoryStageExpressionPatchOut(
            project_id=project_id,
            revision=body.expected_revision + 1,
            updated_at=updated_at,
            block=updated,
        )

    async def patch_edits(
        self, project_id: str, body: GalgameStoryEditsPatchIn
    ) -> GalgameStoryDocumentOut:
        project, row = await self._rows(project_id)
        validated = apply_edits(deepcopy(row.document), body)
        updated_at = await self._save(
            project_id,
            project,
            validated.model_dump(mode="json", by_alias=True),
            body.expected_revision,
        )
        return GalgameStoryDocumentOut(
            project_id=project_id,
            document=validated,
            revision=body.expected_revision + 1,
            updated_at=updated_at,
        )
