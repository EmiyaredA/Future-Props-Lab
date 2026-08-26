from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.schemas.galgame_workshop.base_core import (
    STABLE_ID_PATTERN,
    GalgameStoryModel,
    _clean_title,
)
from app.schemas.galgame_workshop.block_core import GalgameStoryBlockBase


class GalgameStoryAnimateSpriteBlock(GalgameStoryBlockBase):
    type: Literal["animateSprite"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    animation: str = Field(default="idle", min_length=1, max_length=120)
    direction: Literal["none", "left", "right", "towardCenter", "awayFromCenter"] = "none"
    intensity: float = Field(default=1, ge=0.1, le=3)
    easing: Literal["linear", "ease", "easeIn", "easeOut", "easeInOut"] = "easeInOut"
    duration_ms: int = Field(default=500, alias="durationMs", ge=0, le=600_000)
    loop: bool = False
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryAutoPlayBlock(GalgameStoryBlockBase):
    type: Literal["autoPlay"]
    enabled: bool = True
    delay_ms: int = Field(default=1200, alias="delayMs", ge=0, le=600_000)


class GalgameStorySwitchDialogueStyleBlock(GalgameStoryBlockBase):
    type: Literal["switchDialogueStyle"]
    preset: Literal["dark", "light", "accent", "classicGradient", "custom"] = "dark"


class GalgameStoryPortraitStyleRuleBlock(GalgameStoryBlockBase):
    type: Literal["portraitStyleRule"]
    mode: Literal["stage", "solo", "hidden"] = "stage"
    keep_after: bool = Field(default=True, alias="keepAfter")


class GalgameStoryGalleryBlock(GalgameStoryBlockBase):
    type: Literal["gallery"]
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
    action: Literal["unlockCg", "unlockScene", "unlockMusic"] = "unlockCg"


class GalgameStoryBranchChoice(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    text: str = Field(default="", max_length=1000)
    target_fragment_id: str = Field(alias="targetFragmentId", pattern=STABLE_ID_PATTERN)


class GalgameStoryBranchBlock(GalgameStoryBlockBase):
    type: Literal["branch"]
    prompt: str = Field(default="", max_length=2000)
    choices: list[GalgameStoryBranchChoice] = Field(min_length=2, max_length=12)

    @field_validator("choices")
    @classmethod
    def choice_ids_are_unique(
        cls, choices: list[GalgameStoryBranchChoice]
    ) -> list[GalgameStoryBranchChoice]:
        ids = [choice.id for choice in choices]
        if len(ids) != len(set(ids)):
            raise ValueError("同一分支的选项 ID 不能重复")
        return choices


class GalgameStoryIfBlock(GalgameStoryBlockBase):
    type: Literal["if"]
    condition: str = Field(min_length=1, max_length=2000)
    then_fragment_id: str = Field(alias="thenFragmentId", pattern=STABLE_ID_PATTERN)
    else_fragment_id: str | None = Field(
        default=None, alias="elseFragmentId", pattern=STABLE_ID_PATTERN
    )


class GalgameStorySetVariableBlock(GalgameStoryBlockBase):
    type: Literal["setVariable"]
    variable_id: str = Field(alias="variableId", pattern=STABLE_ID_PATTERN)
    operator: Literal["set", "add", "subtract", "multiply", "divide", "toggle"] = "set"
    value: str | int | float | bool | None = None


class GalgameStoryCallFragmentBlock(GalgameStoryBlockBase):
    type: Literal["callFragment"]
    target_fragment_id: str = Field(alias="targetFragmentId", pattern=STABLE_ID_PATTERN)


class GalgameStoryEndChapterBlock(GalgameStoryBlockBase):
    type: Literal["endChapter"]
    ending_id: str | None = Field(default=None, alias="endingId", pattern=STABLE_ID_PATTERN)
    label: str = Field(default="结束章节", min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryReturnToEntryBlock(GalgameStoryBlockBase):
    type: Literal["returnToEntry"]
