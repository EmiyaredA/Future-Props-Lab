from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.galgame_workshop.base import STABLE_ID_PATTERN

GalgameVideoExportPreset = Literal["1080p30", "720p30", "1080p60"]
GalgameVideoExportStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
GalgameVideoExportPhase = Literal[
    "queued",
    "preparing",
    "rendering",
    "encoding",
    "verifying",
    "registering",
    "completed",
    "failed",
    "cancelled",
]


class GalgameVideoExportBranchSelection(BaseModel):
    branch_block_id: str = Field(alias="branchBlockId", pattern=STABLE_ID_PATTERN)
    choice_id: str = Field(alias="choiceId", pattern=STABLE_ID_PATTERN)


class GalgameVideoExportPreviewIn(BaseModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    locale: str = Field(default="zh", min_length=1, max_length=32)
    preset: GalgameVideoExportPreset = "1080p30"
    branch_selections: list[GalgameVideoExportBranchSelection] = Field(
        default_factory=list, alias="branchSelections", max_length=256
    )

    @field_validator("branch_selections")
    @classmethod
    def selections_are_unique(
        cls, value: list[GalgameVideoExportBranchSelection]
    ) -> list[GalgameVideoExportBranchSelection]:
        ids = [item.branch_block_id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("同一个分支 Block 只能选择一次")
        return value


class GalgameVideoExportCreateIn(GalgameVideoExportPreviewIn):
    request_id: str = Field(alias="requestId", pattern=STABLE_ID_PATTERN)
    preview_fingerprint: str = Field(alias="previewFingerprint", pattern=r"^[a-f0-9]{64}$")


class GalgameVideoExportIssue(BaseModel):
    code: str
    message: str
    path: str = ""


class GalgameVideoExportChoiceOut(BaseModel):
    id: str
    text: str
    target_fragment_id: str = Field(alias="targetFragmentId")


class GalgameVideoExportDecisionOut(BaseModel):
    branch_block_id: str = Field(alias="branchBlockId")
    prompt: str
    choices: list[GalgameVideoExportChoiceOut]


class GalgameVideoExportRouteOut(BaseModel):
    chapter_ids: list[str] = Field(alias="chapterIds")
    fragment_ids: list[str] = Field(alias="fragmentIds")
    branch_block_ids: list[str] = Field(alias="branchBlockIds")
    ending_label: str = Field(alias="endingLabel")
    estimated_duration_ms: int = Field(alias="estimatedDurationMs", ge=0)
    exact_duration: bool = Field(alias="exactDuration")


class GalgameVideoExportPreviewOut(BaseModel):
    ready: bool
    story_revision: int = Field(alias="storyRevision")
    preset: GalgameVideoExportPreset
    width: int
    height: int
    fps: int
    preview_fingerprint: str = Field(alias="previewFingerprint")
    route: GalgameVideoExportRouteOut
    next_decision: GalgameVideoExportDecisionOut | None = Field(default=None, alias="nextDecision")
    blockers: list[GalgameVideoExportIssue] = Field(default_factory=list)
    warnings: list[GalgameVideoExportIssue] = Field(default_factory=list)


class GalgameVideoExportTaskOut(BaseModel):
    id: str
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId")
    story_revision: int = Field(alias="storyRevision")
    status: GalgameVideoExportStatus
    phase: GalgameVideoExportPhase
    progress: int = Field(ge=0, le=100)
    rendered_ms: int = Field(default=0, alias="renderedMs", ge=0)
    total_ms: int = Field(default=0, alias="totalMs", ge=0)
    preset: GalgameVideoExportPreset
    ending_label: str = Field(default="", alias="endingLabel")
    output_asset_id: str | None = Field(default=None, alias="outputAssetId")
    output_filename: str | None = Field(default=None, alias="outputFilename")
    error: str | None = None
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    started_at: str | None = Field(default=None, alias="startedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")


class GalgameVideoExportTaskListOut(BaseModel):
    items: list[GalgameVideoExportTaskOut]
