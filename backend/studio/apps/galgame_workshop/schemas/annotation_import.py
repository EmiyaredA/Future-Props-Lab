from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from studio.apps.galgame_workshop.schemas.base import STABLE_ID_PATTERN, GalgameStoryModel
from studio.apps.galgame_workshop.schemas.story import GalgameStoryProject


class GalgameAnnotationImportRequirements(GalgameStoryModel):
    segment_count: int = Field(alias="segmentCount", ge=1, le=2000)
    speaker_count: int = Field(alias="speakerCount", ge=1, le=200)
    multi_speaker_count: int = Field(alias="multiSpeakerCount", ge=0, le=2000)
    curtain_interval_count: int = Field(alias="curtainIntervalCount", ge=0, le=2000)
    stage_transition_count: int = Field(alias="stageTransitionCount", ge=0, le=500)
    timeline_duration_ms: int = Field(alias="timelineDurationMs", ge=1)
    last_dialogue_end_ms: int = Field(alias="lastDialogueEndMs", ge=1)
    source_checksum_sha256: str = Field(alias="sourceChecksumSha256", pattern=r"^[0-9a-f]{64}$")
    max_duration_difference_ms: int = Field(
        default=50, alias="maxDurationDifferenceMs", ge=0, le=1000
    )
    min_content_correlation: float = Field(default=0.9, alias="minContentCorrelation", ge=-1, le=1)


class GalgameAnnotationImportIn(GalgameStoryModel):
    request_id: str = Field(alias="requestId", pattern=STABLE_ID_PATTERN)
    asset_prefix: str = Field(alias="assetPrefix", pattern=STABLE_ID_PATTERN)
    source_project_id: str = Field(alias="sourceProjectId", min_length=1, max_length=36)
    master_asset_id: str = Field(alias="masterAssetId", min_length=1, max_length=36)
    expected_source_revision: int = Field(alias="expectedSourceRevision", ge=0)
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    language: Literal["zh"] = "zh"
    speaker_map: dict[str, str] = Field(alias="speakerMap", min_length=1, max_length=200)
    segment_speaker_overrides: dict[str, list[str]] = Field(
        default_factory=dict,
        alias="segmentSpeakerOverrides",
        max_length=200,
    )
    requirements: GalgameAnnotationImportRequirements
    document: GalgameStoryProject

    @field_validator("speaker_map")
    @classmethod
    def speaker_map_ids_are_stable(cls, value: dict[str, str]) -> dict[str, str]:
        import re

        pattern = re.compile(STABLE_ID_PATTERN)
        if any(
            not pattern.fullmatch(source) or not pattern.fullmatch(target)
            for source, target in value.items()
        ):
            raise ValueError("说话人映射必须使用稳定 ID")
        return value

    @field_validator("segment_speaker_overrides")
    @classmethod
    def override_ids_are_stable(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        import re

        pattern = re.compile(STABLE_ID_PATTERN)
        for segment_id, speaker_ids in value.items():
            if (
                not pattern.fullmatch(segment_id)
                or not speaker_ids
                or len(speaker_ids) != len(set(speaker_ids))
                or any(not pattern.fullmatch(speaker_id) for speaker_id in speaker_ids)
            ):
                raise ValueError("片段说话人覆盖必须使用非空且不重复的稳定 ID")
        return value


class GalgameAnnotationImportIssue(BaseModel):
    code: str
    message: str
    path: str = ""


class GalgameAnnotationImportSegmentOut(BaseModel):
    segment_id: str = Field(alias="segmentId")
    block_id: str = Field(alias="blockId")
    story_asset_id: str = Field(alias="storyAssetId")
    start_ms: int = Field(alias="startMs")
    end_ms: int = Field(alias="endMs")
    text: str
    source_speaker_ids: list[str] = Field(alias="sourceSpeakerIds")
    story_speaker_ids: list[str] = Field(alias="storySpeakerIds")


class GalgameAnnotationImportPreviewOut(BaseModel):
    ready: bool
    source_project_id: str = Field(alias="sourceProjectId")
    source_revision: int = Field(alias="sourceRevision")
    story_revision: int = Field(alias="storyRevision")
    source_asset_id: str = Field(alias="sourceAssetId")
    master_asset_id: str = Field(alias="masterAssetId")
    source_checksum_sha256: str = Field(alias="sourceChecksumSha256")
    timeline_duration_ms: int = Field(alias="timelineDurationMs")
    segment_count: int = Field(alias="segmentCount")
    speaker_count: int = Field(alias="speakerCount")
    multi_speaker_count: int = Field(alias="multiSpeakerCount")
    curtain_interval_count: int = Field(alias="curtainIntervalCount")
    stage_transition_count: int = Field(alias="stageTransitionCount")
    issues: list[GalgameAnnotationImportIssue] = Field(default_factory=list)
    segments: list[GalgameAnnotationImportSegmentOut] = Field(default_factory=list)


GalgameAnnotationImportStatus = Literal[
    "queued", "running", "completed", "failed", "conflict", "rolled_back"
]
GalgameAnnotationImportPhase = Literal[
    "queued",
    "cutting",
    "validating",
    "saving",
    "accepting",
    "rolling_back",
    "completed",
    "failed",
    "conflict",
    "rolled_back",
]


class GalgameAnnotationImportTaskOut(BaseModel):
    id: str
    project_id: str = Field(alias="projectId")
    source_project_id: str = Field(alias="sourceProjectId")
    request_id: str = Field(alias="requestId")
    status: GalgameAnnotationImportStatus
    phase: GalgameAnnotationImportPhase
    progress: int
    result: dict = Field(default_factory=dict)
    error: str | None = None
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    started_at: str | None = Field(default=None, alias="startedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")
