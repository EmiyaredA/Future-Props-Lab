from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.capabilities.media_rendering.live2d.document import (
    CharacterDocument,
    Identifier,
    ValueModel,
)

PetEventName = Literal["idle", "click", "pet", "grab", "drop", "roam"]
HoverAction = Literal["dress", "roam", "hide", "settings", "chat"]


class PetReaction(ValueModel):
    motion_id: Identifier | None = Field(default=None, alias="motionId")
    expression_id: Identifier | None = Field(default=None, alias="expressionId")
    lines: list[str] = Field(default_factory=list, max_length=8)
    sound: Literal["none", "tap", "chime"] = "none"

    @model_validator(mode="after")
    def valid_lines(self) -> PetReaction:
        if any(not line.strip() or len(line) > 140 for line in self.lines):
            raise ValueError("每句台词需要 1–140 个字符")
        return self


class PetPersona(ValueModel):
    description: str = Field(default="", max_length=500)
    personality: str = Field(default="", max_length=500)
    speaking_style: str = Field(default="", alias="speakingStyle", max_length=500)
    greeting: str = Field(default="", max_length=140)


class PetSkin(ValueModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=60)
    replacements: dict[Identifier, Identifier] = Field(default_factory=dict, max_length=128)


class PetHabits(ValueModel):
    roam: Literal["free", "calm", "off"] = "calm"
    size: int = Field(default=220, ge=160, le=300)
    draggable: bool = True
    bubbles: bool = True
    sound: bool = True
    hover_actions: list[HoverAction] = Field(
        default_factory=lambda: ["dress", "roam", "hide", "chat"],
        alias="hoverActions",
        max_length=4,
    )

    @model_validator(mode="after")
    def unique_actions(self) -> PetHabits:
        if len(self.hover_actions) != len(set(self.hover_actions)):
            raise ValueError("悬停按钮不能重复")
        return self


class PetConfig(ValueModel):
    schema_version: Literal[2] = Field(default=2, alias="schemaVersion")
    skins: list[PetSkin] = Field(default_factory=list, max_length=20)
    active_skin_id: Identifier | None = Field(default=None, alias="activeSkinId")
    scheme_id: Identifier | None = Field(default=None, alias="schemeId")
    events: dict[PetEventName, PetReaction] = Field(default_factory=dict, max_length=6)
    habits: PetHabits = Field(default_factory=PetHabits)
    persona: PetPersona = Field(default_factory=PetPersona)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        if value.get("schemaVersion", 1) not in (1, 2):
            return value
        upgraded = dict(value)
        upgraded["schemaVersion"] = 2
        events = {}
        for name, reaction in (value.get("events") or {}).items():
            item = dict(reaction)
            bubble = item.pop("bubble", "")
            item.setdefault("lines", [bubble] if bubble else [])
            events[name] = item
        upgraded["events"] = events
        habits = dict(value.get("habits") or {})
        if value.get("schemaVersion", 1) != 2 and habits.get("hoverActions") == [
            "dress",
            "roam",
            "hide",
        ]:
            habits["hoverActions"] = ["dress", "roam", "hide", "chat"]
        upgraded["habits"] = habits
        return upgraded

    @model_validator(mode="after")
    def valid_skin_selection(self) -> PetConfig:
        ids = [skin.id for skin in self.skins]
        if len(ids) != len(set(ids)):
            raise ValueError("皮肤 ID 不能重复")
        if self.active_skin_id is not None and self.active_skin_id not in ids:
            raise ValueError("当前皮肤不存在")
        return self


class PetCreate(ValueModel):
    source_project_id: str = Field(alias="sourceProjectId", min_length=1, max_length=36)
    source_revision: int = Field(alias="sourceRevision", ge=0)
    title: str = Field(default="", max_length=120)


class PetPatch(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    title: str = Field(min_length=1, max_length=120)


class PetSave(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    config: PetConfig


class PetSync(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    source_revision: int = Field(alias="sourceRevision", ge=0)


class PetProjectOut(ValueModel):
    id: str
    title: str
    revision: int
    source_type: Literal["live2d", "coopanion-whale"] = Field(alias="sourceType")
    source_project_id: str | None = Field(alias="sourceProjectId")
    source_revision: int | None = Field(alias="sourceRevision")
    source_title: str = Field(alias="sourceTitle")
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class PetProjectsOut(ValueModel):
    items: list[PetProjectOut]


class PetDocumentOut(ValueModel):
    revision: int
    source_type: Literal["live2d", "coopanion-whale"] = Field(alias="sourceType")
    source_revision: int | None = Field(alias="sourceRevision")
    character: CharacterDocument | None
    whale_model: dict | None = Field(alias="whaleModel")
    whale_assets: dict[str, str] | None = Field(alias="whaleAssets")
    config: PetConfig
    asset_urls: dict[str, str] = Field(alias="assetUrls")
