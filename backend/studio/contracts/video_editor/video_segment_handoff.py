"""Bound an ordered Video segment group to one owned Visual canvas decision."""

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.video_editor.video_assets import SOURCE
from studio.runtime.messaging.timed_peer import TimedPeer

TARGETS = "/_internal/v1/video-segment-targets"
TARGET_PURPOSE = "video.segment-target.read"
VISUAL_HANDOFFS = "/_internal/v1/video-segment-handoffs"
ASSET_HANDOFFS = "/_internal/v1/visual-segment-handoffs"
UUID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"


class SegmentTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: str = Field(pattern="^" + ID + "$")
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    new_title: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def verify_destination(self):
        if (self.expected_revision is None) == (self.new_title is None):
            raise ValueError("分段交接必须绑定既有画布修订或新项目")
        if self.new_title is not None and (
            not self.new_title.strip() or not re.fullmatch(UUID, self.project_id)
        ):
            raise ValueError("分段交接的新项目标识无效")
        return self


class SegmentHandoff(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    source_project_id: str = Field(pattern="^" + ID + "$")
    task_id: str = Field(pattern="^" + UUID + "$")
    manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    target: SegmentTarget

    @property
    def digest(self):
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()

    def path(self, prefix, operation):
        return f"{prefix}/{self.task_id}/{self.digest}/{operation}"


def target_grant(grant):
    return bool(
        grant.caller == "video"
        and grant.purpose == TARGET_PURPOSE
        and grant.source_method == "POST"
        and grant.target_method == "GET"
        and grant.target_service == "visual"
        and re.fullmatch(rf"{SOURCE}/projects/{ID}/segment-exports", grant.source_path)
        and re.fullmatch(rf"{TARGETS}/{ID}", grant.target_path)
    )


def visual_peer(key):
    return TimedPeer(key, domain=b"fpl-video-segment-visual-v1")


def asset_peer(key):
    return TimedPeer(key, domain=b"fpl-visual-segment-assets-v1")
