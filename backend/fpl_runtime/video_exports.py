"""Digest-bound Video export execution and owned publication receipts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID
from .motion_preview import DIGEST
from .timed_peer import TimedPeer
from .video_assets import VideoAsset

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
    files: tuple[ExportInput, ...] = Field(max_length=10000)

    @model_validator(mode="after")
    def validate_scope(self):
        from pathlib import Path

        ids = [item.id for item in self.files]
        if (
            self.end_us <= self.start_us
            or ids != sorted(set(ids))
            or Path(self.filename).name != self.filename
            or "\\" in self.filename
            or not self.filename.endswith(".mp4")
            or any(ord(char) < 32 for char in self.filename)
        ):
            raise ValueError("剪辑导出范围无效")
        return self


class VideoExportReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: int = Field(ge=0, le=100, strict=True)
    probe: dict = Field(default_factory=dict)
    fingerprint: str | None = Field(default=None, pattern="^" + DIGEST + "$")
    output: VideoAsset | None = None
    error: str | None = None

    @model_validator(mode="after")
    def validate_result(self):
        if self.status == "completed":
            if (
                self.output is None
                or self.fingerprint is None
                or not self.probe
                or self.progress != 100
            ):
                raise ValueError("剪辑成片回执不完整")
        elif self.output is not None or self.fingerprint is not None:
            raise ValueError("未完成任务不能提供成片")
        return self


def output_peer(secret):
    return TimedPeer(secret, domain=b"fpl-video-render-outputs-v1")
