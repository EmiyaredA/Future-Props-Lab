from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.apps.galgame_workshop.schemas.base import STABLE_ID_PATTERN, GalgameStoryModel


class GalgameAsrSettingsPatchIn(GalgameStoryModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    model_id: str | None = Field(default=None, alias="modelId", max_length=36)
    default_language: Literal["auto", "zh", "ja"] | None = Field(
        default=None, alias="defaultLanguage"
    )
    concurrency: int | None = Field(default=None, ge=1, le=8)


class GalgameAsrSettingsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model_id: str | None = Field(alias="modelId")
    model_ready: bool = Field(alias="modelReady")
    default_language: Literal["auto", "zh", "ja"] = Field(alias="defaultLanguage")
    concurrency: int
    revision: int


class GalgameTranscriptSegmentOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    speaker: str
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", ge=0)
    text: str


class GalgameTranscriptionCreateIn(GalgameStoryModel):
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=500)
    language: Literal["auto", "zh", "ja"] | None = None
    force: bool = False


class GalgameTranscriptionTaskOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    asset_id: str = Field(alias="assetId")
    provider_name: str = Field(alias="providerName")
    model_slug: str = Field(alias="modelSlug")
    language: Literal["auto", "zh", "ja"]
    force: bool
    status: Literal["queued", "running", "completed", "failed"]
    result_text: str | None = Field(default=None, alias="resultText")
    result_segments: list[GalgameTranscriptSegmentOut] = Field(
        default_factory=list, alias="resultSegments"
    )
    error: str | None = None
    revision: int
    created_at: str = Field(alias="createdAt")
    started_at: str | None = Field(default=None, alias="startedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")


class GalgameTranscriptionTaskListOut(BaseModel):
    items: list[GalgameTranscriptionTaskOut]


class GalgameTranscriptPatchIn(GalgameStoryModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    text: str = Field(max_length=20_000)
    language: Literal["auto", "zh", "ja"] | None = None


class GalgameVoiceMatchIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=500)
    block_ids: list[Annotated[str, Field(pattern=STABLE_ID_PATTERN)]] | None = Field(
        default=None, alias="blockIds", max_length=500
    )
    minimum_similarity: float = Field(default=0.72, alias="minimumSimilarity", ge=0, le=1)


class GalgameVoiceMatchItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    asset_id: str = Field(alias="assetId")
    block_id: str = Field(alias="blockId")
    similarity: float


class GalgameVoiceMatchOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    story_revision: int = Field(alias="storyRevision")
    matches: list[GalgameVoiceMatchItem]
    unmatched_asset_ids: list[str] = Field(alias="unmatchedAssetIds")
