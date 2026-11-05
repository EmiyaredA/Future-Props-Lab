"""Apply Story editor commands to a caller-owned document value."""

from typing import Any

from pydantic import ValidationError

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.schemas import (
    GalgameStoryDialogueBlock,
    GalgameStoryDialogueEditIn,
    GalgameStoryDialoguePatchIn,
    GalgameStoryEditsPatchIn,
    GalgameStoryProject,
    GalgameStorySetStageCastBlock,
    GalgameStoryShowCharacterBlock,
    GalgameStoryStageExpressionEditIn,
    GalgameStoryStageExpressionPatchIn,
)


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


def apply_dialogue(
    document: dict[str, Any],
    body: GalgameStoryDialoguePatchIn | GalgameStoryDialogueEditIn,
) -> GalgameStoryDialogueBlock:
    blocks, index, payload = _target_block(document, body.fragment_id, body.block_id)
    if payload.get("type") != "dialogue":
        raise GalgameStoryDocumentInvalidError("目标 Block 不是对白")
    try:
        current = GalgameStoryDialogueBlock.model_validate(payload)
    except ValidationError as exc:
        raise GalgameStoryDocumentInvalidError("目标对白格式无效") from exc
    _validate_expression(document, current.character_id, body.expression_id)
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
    return updated


def apply_stage_expression(
    document: dict[str, Any],
    body: GalgameStoryStageExpressionPatchIn | GalgameStoryStageExpressionEditIn,
) -> GalgameStoryShowCharacterBlock | GalgameStorySetStageCastBlock:
    blocks, index, payload = _target_block(document, body.fragment_id, body.block_id)
    _validate_expression(document, body.character_id, body.expression_id)
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
    return updated


def apply_edits(document: dict[str, Any], body: GalgameStoryEditsPatchIn) -> GalgameStoryProject:
    for edit in body.edits:
        if isinstance(edit, GalgameStoryDialogueEditIn):
            apply_dialogue(document, edit)
        else:
            apply_stage_expression(document, edit)
    try:
        return GalgameStoryProject.model_validate(document)
    except ValidationError as exc:
        raise GalgameStoryDocumentInvalidError("批量修改后的故事文档无效") from exc
