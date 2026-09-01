from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.galgame_workshop.base import STABLE_ID_PATTERN

GalgameVideoExportPreset = Literal["1080p30", "720p30", "1080p60", "720p60"]
GalgameVideoExportScope = Literal["route", "fragments", "clip"]
GalgameVideoExportStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
GalgameVideoExportPhase = Literal[
    "queued",
    "preparing",
    "analyzing",
    "rendering",
    "encoding",
    "verifying",
    "registering",
    "completed",
    "failed",
    "cancelled",
]


class GalgameVideoExportCaptureFrame(BaseModel):
    """A normalized 16:9 crop on the canonical 1920x1080 stage."""

    x: int = Field(default=0, ge=0, le=1600, multiple_of=2)
    y: int = Field(default=0, ge=0, le=900, multiple_of=2)
    width: int = Field(default=1920, ge=320, le=1920, multiple_of=2)
    height: int = Field(default=1080, ge=180, le=1080, multiple_of=2)

    @model_validator(mode="after")
    def frame_is_valid(self) -> GalgameVideoExportCaptureFrame:
        if self.width * 9 != self.height * 16:
            raise ValueError("视频取景框必须严格保持 16:9")
        if self.x + self.width > 1920 or self.y + self.height > 1080:
            raise ValueError("视频取景框必须完整位于 1920×1080 舞台内")
        return self


class GalgameVideoExportBranchSelection(BaseModel):
    branch_block_id: str = Field(alias="branchBlockId", pattern=STABLE_ID_PATTERN)
    choice_id: str = Field(alias="choiceId", pattern=STABLE_ID_PATTERN)


class GalgameVideoExportClipRange(BaseModel):
    fragment_id: str = Field(alias="fragmentId", pattern=STABLE_ID_PATTERN)
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", ge=1)

    @model_validator(mode="after")
    def range_is_valid(self) -> GalgameVideoExportClipRange:
        if self.end_ms <= self.start_ms:
            raise ValueError("快速试片结束时间必须晚于开始时间")
        if self.end_ms - self.start_ms > 300_000:
            raise ValueError("快速试片最长为 5 分钟")
        return self


class GalgameVideoExportPreviewIn(BaseModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    locale: str = Field(default="zh", min_length=1, max_length=32)
    preset: GalgameVideoExportPreset = "1080p30"
    scope: GalgameVideoExportScope = "route"
    fragment_ids: list[Annotated[str, Field(pattern=STABLE_ID_PATTERN)]] = Field(
        default_factory=list, alias="fragmentIds", max_length=500
    )
    clip_range: GalgameVideoExportClipRange | None = Field(default=None, alias="clipRange")
    branch_selections: list[GalgameVideoExportBranchSelection] = Field(
        default_factory=list, alias="branchSelections", max_length=256
    )
    capture_frame: GalgameVideoExportCaptureFrame = Field(
        default_factory=GalgameVideoExportCaptureFrame, alias="captureFrame"
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

    @field_validator("fragment_ids")
    @classmethod
    def fragment_ids_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("同一个 Fragment 只能选择一次")
        return value

    @model_validator(mode="after")
    def scope_fields_are_consistent(self) -> GalgameVideoExportPreviewIn:
        if self.scope == "fragments" and not self.fragment_ids:
            raise ValueError("片段导出至少需要选择一个 Fragment")
        if self.scope != "fragments" and self.fragment_ids:
            raise ValueError("只有片段导出可以提交 fragmentIds")
        if self.scope == "fragments" and self.branch_selections:
            raise ValueError("片段导出不需要提交分支选择")
        if self.scope == "clip" and self.clip_range is None:
            raise ValueError("快速试片必须提交 clipRange")
        if self.scope != "clip" and self.clip_range is not None:
            raise ValueError("只有快速试片可以提交 clipRange")
        if self.scope == "clip" and self.branch_selections:
            raise ValueError("快速试片不需要提交分支选择")
        return self


class GalgameVideoExportCreateIn(GalgameVideoExportPreviewIn):
    request_id: str = Field(alias="requestId", pattern=STABLE_ID_PATTERN)
    preview_fingerprint: str = Field(alias="previewFingerprint", pattern=r"^[a-f0-9]{64}$")


class GalgameVideoExportFrameIn(GalgameVideoExportPreviewIn):
    time_ms: int = Field(alias="timeMs", ge=0)
    width: int = Field(default=960, ge=320, le=1920)


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
    fragment_durations_ms: list[int] = Field(default_factory=list, alias="fragmentDurationsMs")
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
    cancel_requested: bool = Field(alias="cancelRequested")
    error: str | None = None
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    started_at: str | None = Field(default=None, alias="startedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")


class GalgameVideoExportTaskListOut(BaseModel):
    items: list[GalgameVideoExportTaskOut]
