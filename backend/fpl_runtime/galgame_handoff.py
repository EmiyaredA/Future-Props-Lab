"""Exact source and artifact scopes for a Galgame-to-Video project handoff."""

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .galgame_assets import SOURCE
from .galgame_frames import GalgameRenderPlan
from .library_assets import ID
from .motion_preview import DIGEST, sha256

HANDOFF_JOBS = "/_internal/v1/galgame-render-handoffs"
HANDOFF_INPUTS = "/_internal/v1/galgame-render-handoff-inputs"
VIDEO_TARGET = "/_internal/v1/galgame-video-handoffs"
VIDEO_ARCHIVE_SOURCE = "/v1/video-editor/projects/snapshot-imports"
VIDEO_ARCHIVE_HEADER = "X-Fpl-Handoff-Video-Archive"
PURPOSE_VIDEO = "galgame.video-handoff.create"


class HandoffSource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    original_filename: str = Field(min_length=1, max_length=255)
    display_name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=255)
    media_kind: Literal["audio", "video", "image", "font", "document"]


class GalgameHandoff(GalgameRenderPlan):
    title: str = Field(min_length=1, max_length=120)
    source_revision: int = Field(ge=0, strict=True)
    sources: dict[str, HandoffSource]

    @model_validator(mode="after")
    def exact_source_metadata(self):
        if self.sources.keys() != self.sizes.keys():
            raise ValueError("剪辑交接素材元数据与范围不一致")
        return self


class HandoffMedia(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    mime_type: Literal["application/zip"] = "application/zip"
    byte_size: int = Field(ge=1, strict=True)
    content_sha256: str = Field(pattern=rf"^{DIGEST}$")
    track_count: int = Field(ge=0, strict=True)
    asset_count: int = Field(ge=0, strict=True)


def handoff_path(project_id):
    return f"{SOURCE}/{project_id}/video-editor-handoffs"


def video_target(method, path):
    if method not in {"POST", "GET"}:
        return None
    scope = re.fullmatch(rf"{VIDEO_TARGET}/({ID})/({ID})/({DIGEST})", path)
    if not scope:
        return None
    try:
        identity = UUID(scope[2])
    except ValueError:
        return None
    return scope if identity.version == 4 and str(identity) == scope[2] else None


def video_handoff_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "galgame",
        PURPOSE_VIDEO,
        "video",
        "POST",
    ):
        return False
    if (grant.target_method, grant.target_path) == ("POST", VIDEO_ARCHIVE_SOURCE):
        return bool(re.fullmatch(rf"{SOURCE}/{ID}/video-editor-handoffs", grant.source_path))
    scope = video_target(grant.target_method, grant.target_path)
    return bool(scope and grant.source_path == handoff_path(scope[1]))


def handoff_source_digest(project_id, task_id):
    return sha256(f"galgame-video-handoff-v1/{project_id}/{task_id}".encode())


class VideoHandoffReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    state: Literal["pending", "published"]
    project_id: str | None = Field(default=None, pattern=rf"^{ID}$")

    @model_validator(mode="after")
    def project_if_published(self):
        if (self.state == "published") != (self.project_id is not None):
            raise ValueError("剪辑工程交接回执状态无效")
        return self
