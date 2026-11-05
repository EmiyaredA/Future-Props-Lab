from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from studio.apps.galgame_workshop.schemas.base_core import (
    STABLE_ID_PATTERN,
    GalgameStoryModel,
    _clean_title,
)


class GalgameStoryCgVariant(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryCg(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    variants: list[GalgameStoryCgVariant] = Field(default_factory=list, max_length=100)
    default_variant_id: str | None = Field(
        default=None, alias="defaultVariantId", pattern=STABLE_ID_PATTERN
    )

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def variants_are_valid(self) -> GalgameStoryCg:
        variant_ids = [variant.id for variant in self.variants]
        if len(variant_ids) != len(set(variant_ids)):
            raise ValueError("同一 CG 的差分 ID 不能重复")
        if self.default_variant_id is not None:
            if self.default_variant_id not in set(variant_ids):
                raise ValueError("CG 默认差分不存在")
        elif self.variants:
            raise ValueError("存在 CG 差分时必须指定默认差分")
        return self


class GalgameStoryVariable(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    type: Literal["string", "number", "boolean"]
    default_value: str | int | float | bool = Field(alias="defaultValue")
    persistence: Literal["session", "project"] = "session"
    description: str = Field(default="", max_length=2000)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_variable_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        display_name = migrated.pop("displayName", None)
        if display_name is not None:
            migrated["name"] = display_name
        legacy_default = migrated.pop("default", None)
        if "defaultValue" not in migrated and legacy_default is not None:
            migrated["defaultValue"] = legacy_default
        legacy_scope = migrated.pop("scope", None)
        persistence = migrated.get("persistence", legacy_scope)
        if persistence in {"slot", "shared"}:
            migrated["persistence"] = {
                "slot": "session",
                "shared": "project",
            }[persistence]
        return migrated

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def default_matches_type(self) -> GalgameStoryVariable:
        matches = {
            "string": isinstance(self.default_value, str),
            "number": isinstance(self.default_value, (int, float))
            and not isinstance(self.default_value, bool),
            "boolean": isinstance(self.default_value, bool),
        }
        if not matches[self.type]:
            raise ValueError("变量默认值必须与声明类型一致")
        return self


class GalgameStoryCharacterAttributeTemplate(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    type: Literal["string", "number", "boolean"]
    default_value: str | int | float | bool = Field(alias="defaultValue")
    description: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def default_matches_type(self) -> GalgameStoryCharacterAttributeTemplate:
        matches = {
            "string": isinstance(self.default_value, str),
            "number": isinstance(self.default_value, (int, float))
            and not isinstance(self.default_value, bool),
            "boolean": isinstance(self.default_value, bool),
        }
        if not matches[self.type]:
            raise ValueError("角色属性默认值必须与声明类型一致")
        return self
