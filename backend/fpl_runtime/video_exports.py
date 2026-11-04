"""Digest-bound Video export execution and owned publication receipts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from .library_assets import ID
from .motion_preview import DIGEST
from .timed_peer import TimedPeer
from .video_assets import VideoAsset
from .video_segments import PublishedSegment

EXPORTS = "/_internal/v1/video-export-jobs"
OUTPUTS = "/_internal/v1/video-render-outputs"
MAX_EXPORT_REQUEST_BYTES = 16 * 1024 * 1024
MAX_EXPORT_INPUT_BYTES = 8 * 1024**3


class ExportInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern="^" + ID + "$")
    sha256: str = Field(pattern="^" + DIGEST + "$")


class VideoExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    document: dict
    preset: str
    start_us: int = Field(ge=0, strict=True)
    end_us: int = Field(gt=0, strict=True)
    filename: str = Field(min_length=1, max_length=255)
    transparent: bool = False
    video_bake: bool = False
    files: tuple[ExportInput, ...] = Field(max_length=10000)

    @model_validator(mode="after")
    def validate_scope(self):
        from pathlib import Path

        ids = [item.id for item in self.files]
        if (
            self.end_us <= self.start_us
            or (self.transparent and self.video_bake)
            or ids != sorted(set(ids))
            or Path(self.filename).name != self.filename
            or "\\" in self.filename
            or not self.filename.endswith(".mov" if self.transparent else ".mp4")
            or any(ord(char) < 32 for char in self.filename)
        ):
            raise ValueError("剪辑导出范围无效")
        return self


class VideoImageBakeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    filename: str = Field(min_length=5, max_length=255)
    image_bake: dict
    files: tuple[ExportInput] = Field(min_length=1, max_length=1)

    @model_validator(mode="after")
    def validate_filename(self):
        from pathlib import Path

        if (
            Path(self.filename).name != self.filename
            or "\\" in self.filename
            or not self.filename.endswith(".png")
            or any(ord(char) < 32 for char in self.filename)
        ):
            raise ValueError("剪辑烘焙文件名无效")
        return self


class SegmentEncodeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    asset_id: str = Field(pattern="^" + ID + "$")
    filename: str = Field(min_length=5, max_length=255)
    source_in_us: int = Field(ge=0, strict=True)
    duration_us: int = Field(gt=0, strict=True)
    playback_rate: float = Field(ge=0.25, le=4)
    resolution: Literal["source", "720p", "1080p"]
    fps: Literal["source", 30, 60]
    quality: Literal["high", "balanced", "small"]
    audio_mode: Literal["keep", "mute"]

    @model_validator(mode="after")
    def verify_name(self):
        from pathlib import Path

        if (
            Path(self.filename).name != self.filename
            or "\\" in self.filename
            or not self.filename.endswith(".mp4")
            or any(ord(char) < 32 for char in self.filename)
        ):
            raise ValueError("分段文件名无效")
        return self


class VideoSegmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    segments: tuple[SegmentEncodeInput, ...] = Field(min_length=1, max_length=100)
    files: tuple[ExportInput, ...] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def verify_sources(self):
        if [file.id for file in self.files] != sorted({item.asset_id for item in self.segments}):
            raise ValueError("分段原件范围不符")
        return self


class RenderedSegment(PublishedSegment):
    probe: dict = Field(min_length=1)


VIDEO_WORK = TypeAdapter(VideoExportRequest | VideoImageBakeRequest | VideoSegmentRequest)


class VideoExportReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: int = Field(ge=0, le=100, strict=True)
    probe: dict = Field(default_factory=dict)
    fingerprint: str | None = Field(default=None, pattern="^" + DIGEST + "$")
    output: VideoAsset | None = None
    variants: dict[Literal["proxy", "thumbnail", "waveform"], str | None] = Field(
        default_factory=dict
    )
    segments: list[RenderedSegment] = Field(default_factory=list, max_length=100)
    error: str | None = None

    @model_validator(mode="after")
    def validate_result(self):
        if self.status == "completed":
            single = self.output is not None and self.fingerprint is not None and bool(self.probe)
            group = bool(self.segments)
            if (
                single == group
                or (
                    group
                    and (self.output is not None or self.fingerprint is not None or self.variants)
                )
                or self.progress != 100
            ):
                raise ValueError("剪辑成片回执不完整")
        elif (
            self.output is not None
            or self.fingerprint is not None
            or self.variants
            or self.segments
        ):
            raise ValueError("未完成任务不能提供成片")
        return self


def output_peer(secret):
    return TimedPeer(secret, domain=b"fpl-video-render-outputs-v1")
