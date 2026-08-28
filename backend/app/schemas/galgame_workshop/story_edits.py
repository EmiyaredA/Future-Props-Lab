from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.galgame_workshop.base_core import STABLE_ID_PATTERN, GalgameStoryModel
from app.schemas.galgame_workshop.blocks import (
    GalgameStoryDialogueBlock,
    GalgameStoryDialoguePortrait,
    GalgameStoryRichTextDocument,
    GalgameStoryRichTextTextNode,
    GalgameStorySetStageCastBlock,
    GalgameStoryShowCharacterBlock,
)


class GalgameStoryDialogueEditFields(GalgameStoryModel):
    fragment_id: str = Field(alias="fragmentId", pattern=STABLE_ID_PATTERN)
    block_id: str = Field(alias="blockId", pattern=STABLE_ID_PATTERN)
    text: str = Field(max_length=20_000)
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)
    portrait: GalgameStoryDialoguePortrait | None = None

    def rich_text(self) -> GalgameStoryRichTextDocument:
        return GalgameStoryRichTextDocument(
            nodes=[GalgameStoryRichTextTextNode(type="text", text=self.text)] if self.text else []
        )

    def logical_target(self) -> tuple[str, str, str]:
        return ("dialogue", self.fragment_id, self.block_id)


class GalgameStoryDialoguePatchIn(GalgameStoryDialogueEditFields):
    expected_revision: int = Field(ge=0)


class GalgameStoryDialogueEditIn(GalgameStoryDialogueEditFields):
    type: Literal["dialogue"]


class GalgameStoryDialoguePatchOut(BaseModel):
    project_id: str
    revision: int
    updated_at: str
    block: GalgameStoryDialogueBlock


class GalgameStoryStageExpressionEditFields(GalgameStoryModel):
    fragment_id: str = Field(alias="fragmentId", pattern=STABLE_ID_PATTERN)
    block_id: str = Field(alias="blockId", pattern=STABLE_ID_PATTERN)
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)

    def logical_target(self) -> tuple[str, str, str, str]:
        return ("stageExpression", self.fragment_id, self.block_id, self.character_id)


class GalgameStoryStageExpressionPatchIn(GalgameStoryStageExpressionEditFields):
    expected_revision: int = Field(ge=0)


class GalgameStoryStageExpressionEditIn(GalgameStoryStageExpressionEditFields):
    type: Literal["stageExpression"]


class GalgameStoryStageExpressionPatchOut(BaseModel):
    project_id: str
    revision: int
    updated_at: str
    block: GalgameStoryShowCharacterBlock | GalgameStorySetStageCastBlock


GalgameStoryEditIn = Annotated[
    GalgameStoryDialogueEditIn | GalgameStoryStageExpressionEditIn,
    Field(discriminator="type"),
]


class GalgameStoryEditsPatchIn(GalgameStoryModel):
    expected_revision: int = Field(ge=0)
    edits: list[GalgameStoryEditIn] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def targets_are_unique(self) -> GalgameStoryEditsPatchIn:
        targets = [edit.logical_target() for edit in self.edits]
        if len(targets) != len(set(targets)):
            raise ValueError("同一批次不能重复编辑同一目标")
        return self
