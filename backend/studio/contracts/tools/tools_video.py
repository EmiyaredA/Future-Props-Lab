"""Typed native video input and content-bound result; host paths stay local."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.runtime.files.signed_payloads import ModelOutputDescription

VIDEO_JOB_PATH = "/v1/tool-navigation/video-download/jobs"
DOWNLOAD_VIDEO = "tools.video.download"
OUTPUT_DESCRIPTOR_HEADER = "X-Tools-Video-Descriptor"


class VideoDownloadInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    url: str = Field(min_length=8, max_length=4096)
    quality: Literal["best", "1080", "720", "480"]
    cookies_from_browser: (
        Literal["chrome", "chromium", "edge", "safari", "brave", "firefox"] | None
    ) = None


class VideoDownloadResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    title: str = Field(min_length=1, max_length=500)
    filename: str = Field(min_length=1, max_length=255)
    mime_type: Literal["video/mp4", "video/x-matroska", "video/webm", "video/quicktime"]
    byte_size: int = Field(ge=1, strict=True)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def validate_description(self):
        _description = self.description
        return self

    @property
    def description(self):
        return ModelOutputDescription(
            self.filename, self.mime_type, self.byte_size, self.content_sha256
        )

    @classmethod
    def from_file(cls, path: Path, *, title: str, filename: str, mime_type: str):
        description = ModelOutputDescription.from_file(path, filename, mime_type)
        return cls(
            title=title,
            filename=filename,
            mime_type=mime_type,
            byte_size=description.byte_size,
            content_sha256=description.content_sha256,
        )
