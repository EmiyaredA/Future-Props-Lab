from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.galgame_workshop.base import (
    STABLE_ID_PATTERN,
    GalgameStoryModel,
    _clean_title,
)

GalgameStoryPositionBuiltinKey = Literal["left", "centerLeft", "center", "centerRight", "right"]


class GalgameStoryCanvasSettings(GalgameStoryModel):
    width: int = Field(default=1920, ge=640, le=7680)
    height: int = Field(default=1080, ge=360, le=4320)


class GalgameStoryPositionPreset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=40)
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    builtin_key: GalgameStoryPositionBuiltinKey | None = Field(
        default=None,
        alias="builtinKey",
        exclude_if=lambda value: value is None,
    )

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


def default_character_position_presets() -> list[GalgameStoryPositionPreset]:
    return [
        GalgameStoryPositionPreset(id="position-left", name="左", x=25, y=50, builtinKey="left"),
        GalgameStoryPositionPreset(
            id="position-center-left", name="中左", x=37.5, y=50, builtinKey="centerLeft"
        ),
        GalgameStoryPositionPreset(
            id="position-center", name="中", x=50, y=50, builtinKey="center"
        ),
        GalgameStoryPositionPreset(
            id="position-center-right", name="中右", x=62.5, y=50, builtinKey="centerRight"
        ),
        GalgameStoryPositionPreset(id="position-right", name="右", x=75, y=50, builtinKey="right"),
    ]


class GalgameStoryCharacterStageSettings(GalgameStoryModel):
    anchor: Literal["center", "topLeft"] = "center"
    position_presets: list[GalgameStoryPositionPreset] = Field(
        default_factory=default_character_position_presets,
        alias="positionPresets",
        min_length=5,
        max_length=20,
    )
    default_position_id: str = Field(
        default="position-center",
        alias="defaultPositionId",
        pattern=STABLE_ID_PATTERN,
    )
    default_height_percent: float = Field(default=100, alias="defaultHeightPercent", gt=0, le=400)
    legacy_default_scale: float | None = Field(
        default=None,
        alias="legacyDefaultScale",
        gt=0,
        le=4,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def presets_are_valid(self) -> GalgameStoryCharacterStageSettings:
        preset_ids = [preset.id for preset in self.position_presets]
        if len(preset_ids) != len(set(preset_ids)):
            raise ValueError("角色位置预设 ID 不能重复")
        normalized_names = [preset.name.casefold() for preset in self.position_presets]
        if len(normalized_names) != len(set(normalized_names)):
            raise ValueError("角色位置预设名称不能重复")
        builtin_keys = [
            preset.builtin_key for preset in self.position_presets if preset.builtin_key is not None
        ]
        expected_keys = {"left", "centerLeft", "center", "centerRight", "right"}
        if len(builtin_keys) != 5 or set(builtin_keys) != expected_keys:
            raise ValueError("五个内置角色位置预设必须完整且不能重复")
        if self.default_position_id not in set(preset_ids):
            raise ValueError("默认角色位置预设不存在")
        return self


class GalgameStorySettings(GalgameStoryModel):
    canvas: GalgameStoryCanvasSettings = Field(default_factory=GalgameStoryCanvasSettings)
    character_stage: GalgameStoryCharacterStageSettings = Field(
        default_factory=GalgameStoryCharacterStageSettings,
        alias="characterStage",
    )
    character_stage_overrides: dict[str, GalgameStoryCharacterStageSettings] = Field(
        default_factory=dict,
        alias="characterStageOverrides",
        max_length=200,
        exclude_if=lambda value: not value,
    )
