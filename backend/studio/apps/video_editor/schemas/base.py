from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.capabilities.media_rendering.timeline_document import VideoEditorChromaKey
from studio.contracts.asset_library.project_snapshots import ProjectSnapshotImportWarning

VideoEditorPreset = Literal["720p30", "1080p30", "720p60", "1080p60"]
VideoEditorTaskStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class VideoEditorDefaultEffects(BaseModel):
    chroma_key: VideoEditorChromaKey | None = Field(default=None, alias="chromaKey")


class VideoEditorAssetPatchIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    default_effects: VideoEditorDefaultEffects | None = Field(default=None, alias="defaultEffects")
    display_name: str | None = Field(
        default=None, alias="displayName", min_length=1, max_length=255
    )

    @model_validator(mode="after")
    def validate_changes(self) -> VideoEditorAssetPatchIn:
        for field in ("display_name", "default_effects"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError("修改字段不能为 null")
        if self.display_name is not None:
            self.display_name = self.display_name.strip()
            if not self.display_name:
                raise ValueError("素材名称不能为空")
        if self.default_effects is None and self.display_name is None:
            raise ValueError("至少需要提供一个修改字段")
        return self


class VideoEditorAssetBakeCreateIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    effects: VideoEditorDefaultEffects | None = None


class VideoEditorProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("项目名称不能为空")
        return cleaned


class VideoEditorProjectPatchIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["draft", "completed"] | None = None

    @model_validator(mode="after")
    def has_change(self) -> VideoEditorProjectPatchIn:
        if self.title is None and self.status is None:
            raise ValueError("至少需要提供一个修改字段")
        if self.title is not None:
            self.title = self.title.strip()
        return self


class VideoEditorProjectOut(BaseModel):
    id: str
    title: str
    status: Literal["draft", "completed"]
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    source_application: str | None = Field(default=None, alias="sourceApplication")
    source_project_id: str | None = Field(default=None, alias="sourceProjectId")
    source_revision: int | None = Field(default=None, alias="sourceRevision")
    source_compiler_version: str | None = Field(default=None, alias="sourceCompilerVersion")


class VideoEditorProjectListOut(BaseModel):
    items: list[VideoEditorProjectOut]


class VideoEditorProjectSnapshotImportOut(BaseModel):
    project: VideoEditorProjectOut
    warnings: list[ProjectSnapshotImportWarning] = Field(default_factory=list)


class VideoEditorAssetImportIn(BaseModel):
    asset_ids: list[str] = Field(alias="assetIds", min_length=1, max_length=100)

    @field_validator("asset_ids")
    @classmethod
    def unique_assets(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("assetIds 不能包含重复项")
        return value


class VideoEditorAssetOut(BaseModel):
    id: str
    display_name: str = Field(alias="displayName")
    original_filename: str = Field(alias="originalFilename")
    media_kind: str = Field(alias="mediaKind")
    mime_type: str = Field(alias="mimeType")
    byte_size: int = Field(alias="byteSize")
    processing_status: str = Field(alias="processingStatus")
    probe: dict = Field(default_factory=dict)
    proxy_url: str | None = Field(default=None, alias="proxyUrl")
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    waveform_url: str | None = Field(default=None, alias="waveformUrl")
    error: str | None = None
    default_effects: VideoEditorDefaultEffects = Field(
        default_factory=VideoEditorDefaultEffects, alias="defaultEffects"
    )
    revision: int = 0
    created_at: str = Field(alias="createdAt")


class VideoEditorAssetListOut(BaseModel):
    items: list[VideoEditorAssetOut]


class VideoEditorAvailableAssetOut(BaseModel):
    id: str
    display_name: str = Field(alias="displayName")
    media_kind: str = Field(alias="mediaKind")
    mime_type: str = Field(alias="mimeType")
    source_application: str = Field(alias="sourceApplication")


class VideoEditorAvailableAssetListOut(BaseModel):
    items: list[VideoEditorAvailableAssetOut]


class VideoEditorRenderCreateIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    preset: VideoEditorPreset = "1080p30"
    start_us: int = Field(default=0, alias="startUs", ge=0)
    end_us: int | None = Field(default=None, alias="endUs", ge=1)
    preview_fingerprint: str = Field(alias="previewFingerprint", pattern=r"^[a-f0-9]{64}$")


class VideoEditorRenderPreviewIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    preset: VideoEditorPreset = "1080p30"
    start_us: int = Field(default=0, alias="startUs", ge=0)
    end_us: int | None = Field(default=None, alias="endUs", ge=1)


class VideoEditorRenderIssue(BaseModel):
    code: str
    message: str
    start_us: int | None = Field(default=None, alias="startUs")
    end_us: int | None = Field(default=None, alias="endUs")


class VideoEditorRenderPreviewOut(BaseModel):
    ready: bool
    revision: int
    preset: VideoEditorPreset
    duration_us: int = Field(alias="durationUs")
    frame_count: int = Field(alias="frameCount")
    fingerprint: str
    blockers: list[VideoEditorRenderIssue] = Field(default_factory=list)
    warnings: list[VideoEditorRenderIssue] = Field(default_factory=list)


class VideoEditorSegmentExportTarget(BaseModel):
    project_id: str | None = Field(default=None, alias="projectId", min_length=1, max_length=64)
    new_project_title: str | None = Field(
        default=None, alias="newProjectTitle", min_length=1, max_length=120
    )

    @model_validator(mode="after")
    def exactly_one_target(self) -> VideoEditorSegmentExportTarget:
        if (self.project_id is None) == (self.new_project_title is None):
            raise ValueError("必须选择已有工作坊项目或填写新项目名称")
        if self.new_project_title is not None:
            self.new_project_title = self.new_project_title.strip()
            if not self.new_project_title:
                raise ValueError("新项目名称不能为空")
        return self


class VideoEditorSegmentExportItem(BaseModel):
    clip_id: str = Field(alias="clipId", min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    resolution: Literal["source", "720p", "1080p"] = "source"
    fps: Literal["source", 30, 60] = "source"
    quality: Literal["high", "balanced", "small"] = "balanced"
    audio_mode: Literal["keep", "mute"] = Field(default="keep", alias="audioMode")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("分段名称不能为空")
        return cleaned


class VideoEditorSegmentExportCreateIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    target: VideoEditorSegmentExportTarget | None
    segments: list[VideoEditorSegmentExportItem] = Field(min_length=1, max_length=100)

    @field_validator("segments")
    @classmethod
    def unique_segments(
        cls, value: list[VideoEditorSegmentExportItem]
    ) -> list[VideoEditorSegmentExportItem]:
        clip_ids = [item.clip_id for item in value]
        if len(clip_ids) != len(set(clip_ids)):
            raise ValueError("同一 Clip 不能重复导出")
        return value


class VideoEditorTaskOut(BaseModel):
    id: str
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId")
    kind: Literal["media", "render", "segment_export", "asset_bake", "clip_merge"]
    status: VideoEditorTaskStatus
    progress: int = Field(ge=0, le=100)
    output_asset_id: str | None = Field(default=None, alias="outputAssetId")
    error: str | None = None
    result_detail: dict = Field(default_factory=dict, alias="resultDetail")
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class VideoEditorTaskListOut(BaseModel):
    items: list[VideoEditorTaskOut]
