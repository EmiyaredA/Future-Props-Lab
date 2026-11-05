"""Published Tools video download request and result shapes."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class BinaryStatus(BaseModel):
    name: str
    ok: bool
    path: str | None = None
    version: str | None = None
    hint: str | None = None


class VideoDownloadDepsOut(BaseModel):
    ready: bool
    yt_dlp: BinaryStatus
    ffmpeg: BinaryStatus


class VideoDownloadJobCreate(BaseModel):
    url: str = Field(min_length=8, max_length=4096)
    quality: str = Field(default="best", pattern=r"^(best|1080|720|480)$")
    use_browser_cookies: bool = False
    cookies_from_browser: str = Field(
        default="chrome", pattern=r"^(chrome|chromium|edge|safari|brave|firefox)$"
    )
    save_to_disk: bool = True
    save_to_library: bool = True
    folder_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def require_destination(self) -> VideoDownloadJobCreate:
        if not self.save_to_disk and not self.save_to_library:
            raise ValueError("至少选择一种保存方式")
        if self.folder_id is not None and not self.folder_id.strip():
            self.folder_id = None
        return self


class VideoDownloadAssetOut(BaseModel):
    id: str
    display_name: str
    original_filename: str
    mime_type: str
    byte_size: int


class VideoDownloadJobOut(BaseModel):
    id: str
    status: str
    url: str
    quality: str
    use_browser_cookies: bool
    cookies_from_browser: str | None
    save_to_disk: bool
    save_to_library: bool
    title: str | None = None
    filename: str | None = None
    byte_size: int | None = None
    error: str | None = None
    asset: VideoDownloadAssetOut | None = None
    created_at: str
    updated_at: str
