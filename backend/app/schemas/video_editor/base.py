from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

VideoEditorPreset = Literal["720p30", "1080p30", "720p60", "1080p60"]
VideoEditorTaskStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


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


class VideoEditorProjectListOut(BaseModel):
    items: list[VideoEditorProjectOut]


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


class VideoEditorTaskOut(BaseModel):
    id: str
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId")
    kind: Literal["media", "render"]
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
