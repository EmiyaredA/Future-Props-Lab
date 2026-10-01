from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.capabilities.media_rendering.live2d.document import (
    CharacterDocument,
    Identifier,
    ValueModel,
)

PetEventName = Literal["idle", "click", "pet", "grab", "drop", "roam"]
HoverAction = Literal["dress", "roam", "hide", "settings"]


class PetReaction(ValueModel):
    motion_id: Identifier | None = Field(default=None, alias="motionId")
    expression_id: Identifier | None = Field(default=None, alias="expressionId")
    bubble: str = Field(default="", max_length=140)
    sound: Literal["none", "tap", "chime"] = "none"


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
        default_factory=lambda: ["dress", "roam", "hide"], alias="hoverActions", max_length=4
    )

    @model_validator(mode="after")
    def unique_actions(self) -> PetHabits:
        if len(self.hover_actions) != len(set(self.hover_actions)):
            raise ValueError("悬停按钮不能重复")
        return self


class PetConfig(ValueModel):
    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    skins: list[PetSkin] = Field(default_factory=list, max_length=20)
    active_skin_id: Identifier | None = Field(default=None, alias="activeSkinId")
    events: dict[PetEventName, PetReaction] = Field(default_factory=dict, max_length=6)
    habits: PetHabits = Field(default_factory=PetHabits)

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
    source_project_id: str = Field(alias="sourceProjectId")
    source_revision: int = Field(alias="sourceRevision")
    source_title: str = Field(alias="sourceTitle")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class PetProjectsOut(ValueModel):
    items: list[PetProjectOut]


class PetDocumentOut(ValueModel):
    revision: int
    source_revision: int = Field(alias="sourceRevision")
    character: CharacterDocument
    config: PetConfig
    asset_urls: dict[str, str] = Field(alias="assetUrls")
