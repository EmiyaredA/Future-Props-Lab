from __future__ import annotations

from copy import deepcopy
from typing import Any

from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.time import iso_utc, utc_now
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.story import GalgameStoryDocuments
from app.models import GalgameStoryDocument, GalgameWorkshopProject
from app.schemas.galgame_workshop import (
    GalgameStoryDialogueBlock,
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStorySetStageCastBlock,
    GalgameStoryShowCharacterBlock,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
)


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

    @staticmethod
    def _target_block(
        document: dict[str, Any], fragment_id: str, block_id: str
    ) -> tuple[list[Any], int, dict[str, Any]]:
        fragment = next(
            (
                candidate
                for chapter in document.get("chapters", [])
                if isinstance(chapter, dict)
                for candidate in chapter.get("fragments", [])
                if isinstance(candidate, dict) and candidate.get("id") == fragment_id
            ),
            None,
        )
        if fragment is None:
            raise GalgameStoryDocumentInvalidError("要保存的 Fragment 不存在")
        blocks = fragment.get("blocks", [])
        index = next(
            (
                position
                for position, block in enumerate(blocks)
                if isinstance(block, dict) and block.get("id") == block_id
            ),
            None,
        )
        if index is None:
            raise GalgameStoryDocumentInvalidError("要保存的 Block 不存在")
        payload = blocks[index]
        if not isinstance(payload, dict):
            raise GalgameStoryDocumentInvalidError("目标 Block 格式无效")
        return blocks, index, payload

    @staticmethod
    def _validate_expression(
        document: dict[str, Any], character_id: str, expression_id: str | None
    ) -> None:
        character = next(
            (
                item
                for item in document.get("characters", [])
                if isinstance(item, dict) and item.get("id") == character_id
            ),
            None,
        )
        if character is None:
            raise GalgameStoryDocumentInvalidError("舞台角色不存在")
        if expression_id is not None and expression_id not in {
            expression.get("id")
            for expression in character.get("expressions", [])
            if isinstance(expression, dict)
        }:
            raise GalgameStoryDocumentInvalidError("表情不属于当前角色")

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
        blocks, index, payload = self._target_block(document, body.fragment_id, body.block_id)
        if payload.get("type") != "dialogue":
            raise GalgameStoryDocumentInvalidError("目标 Block 不是对白")
        try:
            current = GalgameStoryDialogueBlock.model_validate(payload)
        except ValidationError as exc:
            raise GalgameStoryDocumentInvalidError("目标对白格式无效") from exc
        self._validate_expression(document, current.character_id, body.expression_id)
        try:
            updated = GalgameStoryDialogueBlock.model_validate(
                {
                    **payload,
                    "text": body.text,
                    "content": body.rich_text().model_dump(mode="json", by_alias=True),
                    "expressionId": body.expression_id,
                    "portrait": body.portrait.model_dump(mode="json", by_alias=True)
                    if body.portrait is not None
                    else None,
                }
            )
        except ValidationError as exc:
            raise GalgameStoryDocumentInvalidError("对白修改内容无效") from exc
        blocks[index] = updated.model_dump(mode="json", by_alias=True)
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
        blocks, index, payload = self._target_block(document, body.fragment_id, body.block_id)
        self._validate_expression(document, body.character_id, body.expression_id)
        try:
            if payload.get("type") == "showCharacter":
                if payload.get("characterId") != body.character_id:
                    raise GalgameStoryDocumentInvalidError("登场指令不包含当前角色")
                updated = GalgameStoryShowCharacterBlock.model_validate(
                    {**payload, "expressionId": body.expression_id}
                )
            elif payload.get("type") == "setStageCast":
                members = payload.get("members", [])
                if not any(
                    isinstance(member, dict) and member.get("characterId") == body.character_id
                    for member in members
                ):
                    raise GalgameStoryDocumentInvalidError("舞台阵容不包含当前角色")
                updated = GalgameStorySetStageCastBlock.model_validate(
                    {
                        **payload,
                        "members": [
                            {**member, "expressionId": body.expression_id}
                            if isinstance(member, dict)
                            and member.get("characterId") == body.character_id
                            else member
                            for member in members
                        ],
                    }
                )
            else:
                raise GalgameStoryDocumentInvalidError("目标 Block 不是角色登场指令")
        except ValidationError as exc:
            raise GalgameStoryDocumentInvalidError("舞台角色表情修改无效") from exc
        blocks[index] = updated.model_dump(mode="json", by_alias=True)
        updated_at = await self._save(project_id, project, document, body.expected_revision)
        return GalgameStoryStageExpressionPatchOut(
            project_id=project_id,
            revision=body.expected_revision + 1,
            updated_at=updated_at,
            block=updated,
        )
