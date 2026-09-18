from __future__ import annotations

from typing import Any

from pydantic import Field, field_validator

from app.apps.galgame_workshop.schemas.base import (
    STABLE_ID_PATTERN,
    GalgameStoryModel,
    _clean_title,
)
from app.apps.galgame_workshop.schemas.blocks import GalgameStoryBlock


class GalgameStoryTimelineMasterAudio(GalgameStoryModel):
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
    volume: int = Field(default=100, ge=0, le=100)


class GalgameStoryFragmentTimeline(GalgameStoryModel):
    duration_ms: int = Field(alias="durationMs", ge=1, description="剧情时间轴总长（毫秒）")
    master_audio: GalgameStoryTimelineMasterAudio | None = Field(
        default=None,
        alias="masterAudio",
        exclude_if=lambda value: value is None,
        description="驱动整段剧情时间轴的完整主音轨",
    )


class GalgameStoryFragment(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    timeline: GalgameStoryFragmentTimeline | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    blocks: list[GalgameStoryBlock] = Field(default_factory=list, max_length=1000)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryChapter(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=1, le=1000)
    entry_fragment_id: str = Field(alias="entryFragmentId", pattern=STABLE_ID_PATTERN)
    disabled: bool | None = None
    fragments: list[GalgameStoryFragment] = Field(default_factory=list, max_length=500)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @field_validator("disabled", mode="before")
    @classmethod
    def disabled_defaults_to_false(cls, value: Any) -> bool:
        return False if value is None else value
