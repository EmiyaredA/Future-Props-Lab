from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.apps.galgame_workshop.schemas.base import STABLE_ID_PATTERN, GalgameStoryModel


class GalgameStoryLocalizationEntry(GalgameStoryModel):
    block_id: str = Field(alias="blockId", pattern=STABLE_ID_PATTERN)
    field: Literal[
        "text",
        "title",
        "acceptLabel",
        "cancelLabel",
        "prompt",
        "choiceText",
        "label",
    ]
    choice_id: str | None = Field(
        default=None,
        alias="choiceId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    source_fingerprint: str = Field(
        alias="sourceFingerprint",
        min_length=1,
        max_length=64,
    )
    text: str = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def choice_id_matches_field(self) -> GalgameStoryLocalizationEntry:
        if self.field == "choiceText" and self.choice_id is None:
            raise ValueError("选项译文必须引用 Choice ID")
        if self.field != "choiceText" and self.choice_id is not None:
            raise ValueError("只有选项译文可以引用 Choice ID")
        return self


class GalgameStoryLocalizationTarget(GalgameStoryModel):
    locale: str = Field(pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
    entries: list[GalgameStoryLocalizationEntry] = Field(
        default_factory=list,
        max_length=20_000,
    )

    @model_validator(mode="after")
    def entry_references_are_unique(self) -> GalgameStoryLocalizationTarget:
        references = [(entry.block_id, entry.field, entry.choice_id) for entry in self.entries]
        if len(references) != len(set(references)):
            raise ValueError("同一目标语言不能重复保存同一个翻译单元")
        return self


class GalgameStoryLocalizations(GalgameStoryModel):
    source_locale: str = Field(
        default="zh-CN",
        alias="sourceLocale",
        pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$",
    )
    default_locale: str = Field(
        default="zh-CN",
        alias="defaultLocale",
        pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$",
    )
    targets: list[GalgameStoryLocalizationTarget] = Field(
        default_factory=list,
        max_length=30,
    )

    @model_validator(mode="after")
    def locales_are_consistent(self) -> GalgameStoryLocalizations:
        target_locales = [target.locale.lower() for target in self.targets]
        if len(target_locales) != len(set(target_locales)):
            raise ValueError("目标语言不能重复")
        if self.source_locale.lower() in set(target_locales):
            raise ValueError("源语言不能同时作为目标语言")
        allowed_defaults = {self.source_locale.lower(), *target_locales}
        if self.default_locale.lower() not in allowed_defaults:
            raise ValueError("游戏启动语言必须是源语言或已配置的目标语言")
        return self
