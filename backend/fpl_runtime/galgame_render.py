"""Authorize the rendering preflight only from its owning Galgame operation."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .galgame_assets import SOURCE
from .library_assets import ID

CAPACITY_PREFIX = "/_internal/v1/galgame-render-capacity"
CAPACITY_PURPOSE = "galgame.render.capacity"


class RendererCapacity(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    missing_programs: tuple[Literal["ffmpeg", "ffprobe"], ...] = Field(max_length=2)
    font_issue: str | None = Field(max_length=512)
    free_bytes: int = Field(ge=0, strict=True)


def capacity_target(method, path):
    return method == "GET" and re.fullmatch(rf"{CAPACITY_PREFIX}/({ID})", path)


def capacity_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "galgame",
        CAPACITY_PURPOSE,
        "rendering",
        "POST",
    ):
        return False
    target = capacity_target(grant.target_method, grant.target_path)
    return bool(
        target
        and grant.source_path
        in {
            f"{SOURCE}/{target[1]}/video-exports",
            f"{SOURCE}/{target[1]}/video-exports/preview",
            f"{SOURCE}/{target[1]}/video-exports/frame",
        }
    )
