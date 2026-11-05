from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from studio.apps.galgame_workshop.schemas.base import STABLE_ID_PATTERN
from studio.apps.galgame_workshop.schemas.video_export import GalgameVideoExportPreviewIn


class GalgameVideoEditorHandoffCreateIn(GalgameVideoExportPreviewIn):
    request_id: str = Field(alias="requestId", pattern=STABLE_ID_PATTERN)
    preview_fingerprint: str = Field(alias="previewFingerprint", pattern=r"^[a-f0-9]{64}$")
    title: str | None = Field(default=None, min_length=1, max_length=120)


class GalgameVideoEditorHandoffTaskOut(BaseModel):
    id: str
    project_id: str = Field(alias="projectId")
    request_id: str = Field(alias="requestId")
    story_revision: int = Field(alias="storyRevision")
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: int = Field(ge=0, le=100)
    output_project_id: str | None = Field(default=None, alias="outputProjectId")
    track_count: int = Field(default=0, alias="trackCount")
    asset_count: int = Field(default=0, alias="assetCount")
    error: str | None = None
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class GalgameVideoEditorHandoffTaskListOut(BaseModel):
    items: list[GalgameVideoEditorHandoffTaskOut]
