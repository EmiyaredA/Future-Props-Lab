"""Shared errors for the video download tool."""

from __future__ import annotations


class VideoDownloadError(ValueError):
    def __init__(self, message: str, *, code: str = "video_download_error", status: int = 422):
        super().__init__(message)
        self.code = code
        self.status = status
