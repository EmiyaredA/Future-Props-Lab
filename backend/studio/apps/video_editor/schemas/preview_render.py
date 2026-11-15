"""Manual preview-cache requests and their owned, version-checked status."""

from pydantic import BaseModel, Field

from .base import VideoEditorTaskOut


class VideoEditorPreviewRenderCreateIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)


class VideoEditorPreviewRenderOut(VideoEditorTaskOut):
    valid: bool
    timeline_revision: int = Field(alias="timelineRevision")
    media_url: str | None = Field(default=None, alias="mediaUrl")


class VideoEditorPreviewRenderListOut(BaseModel):
    items: list[VideoEditorPreviewRenderOut]
