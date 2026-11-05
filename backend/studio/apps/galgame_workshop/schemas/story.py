from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from studio.apps.galgame_workshop.schemas.base import (
    GalgameStoryAsset,
    GalgameStoryCg,
    GalgameStoryCharacter,
    GalgameStoryCharacterAttributeTemplate,
    GalgameStoryPresentation,
    GalgameStoryScene,
    GalgameStorySceneGroup,
    GalgameStoryVariable,
)
from studio.apps.galgame_workshop.schemas.base_core import STABLE_ID_PATTERN, GalgameStoryModel
from studio.apps.galgame_workshop.schemas.localization import GalgameStoryLocalizations
from studio.apps.galgame_workshop.schemas.stage_settings import GalgameStorySettings
from studio.apps.galgame_workshop.schemas.story_legacy import migrate_legacy_story_dict
from studio.apps.galgame_workshop.schemas.story_structure import GalgameStoryChapter
from studio.apps.galgame_workshop.schemas.story_validation import validate_story_project


class GalgameStoryProject(GalgameStoryModel):
    schema_version: Literal["1.4"] = Field(alias="schemaVersion")
    synopsis: str = Field(default="", max_length=10_000)
    entry_chapter_id: str | None = Field(
        default=None, alias="entryChapterId", pattern=STABLE_ID_PATTERN
    )
    characters: list[GalgameStoryCharacter] = Field(default_factory=list, max_length=200)
    character_attribute_templates: list[GalgameStoryCharacterAttributeTemplate] = Field(
        default_factory=list, alias="characterAttributeTemplates", max_length=200
    )
    scene_groups: list[GalgameStorySceneGroup] = Field(
        default_factory=list, alias="sceneGroups", max_length=100
    )
    scenes: list[GalgameStoryScene] = Field(default_factory=list, max_length=200)
    cgs: list[GalgameStoryCg] = Field(default_factory=list, max_length=200)
    variables: list[GalgameStoryVariable] = Field(default_factory=list, max_length=500)
    assets: list[GalgameStoryAsset] = Field(default_factory=list, max_length=2000)
    presentation: GalgameStoryPresentation = Field(default_factory=GalgameStoryPresentation)
    settings: GalgameStorySettings = Field(default_factory=GalgameStorySettings)
    localizations: GalgameStoryLocalizations | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    chapters: list[GalgameStoryChapter] = Field(default_factory=list, min_length=1, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def migrate_v1_defaults(cls, value: Any) -> Any:
        return migrate_legacy_story_dict(value)

    @model_validator(mode="after")
    def references_and_ids_are_valid(self) -> GalgameStoryProject:
        validate_story_project(self)
        return self


class GalgameStoryDocumentPutIn(GalgameStoryModel):
    expected_revision: int = Field(ge=0)
    document: GalgameStoryProject


class GalgameStoryDocumentOut(BaseModel):
    project_id: str
    document: GalgameStoryProject
    revision: int
    updated_at: str
