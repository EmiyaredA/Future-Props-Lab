"""A durable Rendering job for a frozen Galgame route."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .galgame_assets import SOURCE
from .galgame_frames import GalgameRenderPlan
from .library_assets import ID
from .model_outputs import ModelOutputDescription
from .motion_preview import DIGEST

JOBS = "/_internal/v1/galgame-render-exports"
INPUTS = "/_internal/v1/galgame-render-export-inputs"
PURPOSE_JOB = "galgame.video-export.render"
PURPOSE_INPUT = "galgame.video-export-originals.read"


class GalgameExport(GalgameRenderPlan):
    filename: str = Field(min_length=1, max_length=255)

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value):
        ModelOutputDescription(value, "video/mp4", 1, "0" * 64)
        if not value.endswith(".mp4"):
            raise ValueError("Galgame 成片必须是 MP4")
        return value


class ExportMedia(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    filename: str = Field(min_length=1, max_length=255)
    mime_type: Literal["video/mp4"] = "video/mp4"
    byte_size: int = Field(ge=1, strict=True)
    content_sha256: str = Field(pattern=rf"^{DIGEST}$")
    width: int = Field(gt=0, strict=True)
    height: int = Field(gt=0, strict=True)
    duration_ms: int = Field(ge=0, strict=True)


class ExportReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    phase: Literal[
        "queued",
        "preparing",
        "analyzing",
        "rendering",
        "verifying",
        "completed",
        "failed",
        "cancelled",
    ]
    progress: int = Field(ge=0, le=100, strict=True)
    rendered_ms: int = Field(ge=0, strict=True)
    error: str | None = None
    media: ExportMedia | None = None


def submit_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{JOBS}/({ID})/({ID})/({DIGEST})/submit/({DIGEST})", path
    )


def job_target(method, path):
    if method == "GET":
        return re.fullmatch(rf"{JOBS}/({ID})/({ID})/({DIGEST})(?P<download>/download)?", path)
    if method == "POST":
        return re.fullmatch(rf"{JOBS}/({ID})/({ID})/({DIGEST})(?P<change>/cancel|/release)", path)
    return None


def inputs_target(method, path):
    return method == "POST" and re.fullmatch(rf"{INPUTS}/({ID})/({ID})/({DIGEST})", path)


def export_grant(grant):
    if grant.caller != "galgame":
        return False
    destination = (grant.target_service, grant.purpose)
    if destination == ("rendering", PURPOSE_JOB):
        target = submit_target(grant.target_method, grant.target_path) or job_target(
            grant.target_method, grant.target_path
        )
    elif destination == ("assets", PURPOSE_INPUT):
        target = inputs_target(grant.target_method, grant.target_path)
    else:
        return False
    if not target:
        return False
    project = f"{SOURCE}/{target[1]}"
    change = target.groupdict().get("change")
    if grant.source_method == "DELETE":
        return change == "/release" and grant.source_path == project
    if grant.source_method != "POST":
        return False
    original = f"{project}/video-exports"
    if change == "/cancel" and grant.source_path == f"{original}/{target[2]}/cancel":
        return True
    return grant.source_path == original
