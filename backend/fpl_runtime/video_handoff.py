"""Exact account-owned Motion output transfer to a Video Editor timeline."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .library_assets import ID
from .motion_assets import SOURCE as MOTION_SOURCE
from .motion_preview import DIGEST

HANDOFFS = "/_internal/v1/video-motion-handoffs"
TRANSFERS = "/_internal/v1/video-motion-transfers"
PURPOSE = "motion.video-handoff"
UUID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
NONCE = r"[a-f0-9]{32}"
MOVIE_TYPES = {"mp4": "video/mp4", "mov4444": "video/quicktime"}


class MotionHandoff(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    remote_id: str = Field(pattern="^" + NONCE + "$")
    format: Literal["mp4", "mov4444"]
    duration_us: int = Field(ge=1, strict=True)
    new_title: str | None = None


def handoff_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{HANDOFFS}/({ID})/({ID})/({NONCE})/({UUID})/(existing|new)/({DIGEST})",
        path,
    )


def handoff_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "motion",
        PURPOSE,
        "video",
        "POST",
    ):
        return False
    match = handoff_target(grant.target_method, grant.target_path)
    return bool(
        match
        and grant.source_path
        == f"{MOTION_SOURCE}/projects/{match[1]}/exports/{match[2]}/video-editor-handoffs"
    )
