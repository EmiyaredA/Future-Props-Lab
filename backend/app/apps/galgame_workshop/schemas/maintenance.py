from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.apps.galgame_workshop.schemas.assets import GalgameProjectAssetOut
from app.apps.galgame_workshop.schemas.base import GalgameStoryModel


class GalgamePortraitUpgradeItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    expression_id: str = Field(alias="expressionId")
    current_height_percent: float | None = Field(alias="currentHeightPercent")
    target_height_percent: float | None = Field(alias="targetHeightPercent")
    status: Literal["ready", "missing_metadata"]


class GalgamePortraitUpgradePreviewOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    story_revision: int = Field(alias="storyRevision")
    items: list[GalgamePortraitUpgradeItem]


class GalgamePortraitUpgradeApplyIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)


class GalgameStorySnapshotOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    story_revision: int = Field(alias="storyRevision")
    reason: str
    created_at: str = Field(alias="createdAt")


class GalgameStorySnapshotRestoreIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)


class GalgameAssetReferenceLocation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str
    label: str
    chapter_id: str | None = Field(default=None, alias="chapterId")
    fragment_id: str | None = Field(default=None, alias="fragmentId")
    block_id: str | None = Field(default=None, alias="blockId")
    character_id: str | None = Field(default=None, alias="characterId")
    scene_id: str | None = Field(default=None, alias="sceneId")
    cg_id: str | None = Field(default=None, alias="cgId")


class GalgameAssetOverviewItem(GalgameProjectAssetOut):
    category: Literal[
        "character",
        "scene",
        "cg",
        "bgm",
        "ambient",
        "sfx",
        "voice",
        "video",
        "font",
        "other",
    ]
    story_asset_id: str | None = None
    story_role: str | None = None
    bound_character_ids: list[str] = Field(default_factory=list)
    reference_count: int = 0
    references: list[GalgameAssetReferenceLocation] = Field(default_factory=list)
    orphaned: bool = False
    missing: bool = False


class GalgameMissingAssetOverviewItem(BaseModel):
    story_asset_id: str
    file_id: str
    story_role: str
    references: list[GalgameAssetReferenceLocation] = Field(default_factory=list)
    missing: Literal[True] = True


class GalgameAssetOverviewOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: list[GalgameAssetOverviewItem]
    missing_items: list[GalgameMissingAssetOverviewItem]
    total_bytes: int = Field(default=0, alias="totalBytes")
    referenced_count: int = Field(default=0, alias="referencedCount")
    orphaned_count: int = Field(default=0, alias="orphanedCount")
    estimated_package_bytes: int = Field(default=0, alias="estimatedPackageBytes")
    type_distribution: dict[str, int] = Field(default_factory=dict, alias="typeDistribution")
    largest_asset_ids: list[str] = Field(default_factory=list, alias="largestAssetIds")
    module_health: dict[str, str] = Field(default_factory=dict, alias="moduleHealth")
