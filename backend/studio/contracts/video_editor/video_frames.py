"""Versioned, digest-bound request for one Video Editor still or text layer."""

import re

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.motion_compositor.motion_preview import DIGEST, FrameScope, sha256
from studio.contracts.video_editor.video_assets import SOURCE

PREFIX = "/_internal/v1/video-frame"
INPUTS = "/_internal/v1/video-frame-inputs"
PURPOSE = "video.frame.render"
MAX_FRAME_BYTES = 16 * 1024 * 1024


class VideoFrameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    revision: int = Field(ge=0, strict=True)
    time_us: int = Field(ge=0, strict=True)
    width: int = Field(ge=320, le=1920, strict=True)
    without_chroma_clip_id: str | None = None
    document: dict
    scope: FrameScope


class TextLayerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    revision: int = Field(ge=0, strict=True)
    clip: dict
    scope: FrameScope


def target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{PREFIX}/({ID})/(frame|text/({DIGEST}))/({DIGEST})/({DIGEST})", path
    )


def frame_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "video",
        PURPOSE,
        "rendering",
        "GET",
    ):
        return False
    match = target(grant.target_method, grant.target_path)
    if not match:
        return False
    project, kind, clip, _, _ = match.groups()
    source = f"{SOURCE}/projects/{project}"
    if kind == "frame":
        return grant.source_path == source + "/preview/frame"
    original = re.fullmatch(rf"{source}/text-clips/([^/]{{1,64}})/layer", grant.source_path)
    return bool(original and clip == clip_digest(original[1]))


def clip_digest(clip_id):
    return sha256(clip_id.encode("utf-8"))
