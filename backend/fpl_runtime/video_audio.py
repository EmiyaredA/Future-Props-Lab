"""Bind an audio seam analysis to one checked Video project original."""

import re

from pydantic import BaseModel, ConfigDict, Field

from .library_assets import ID
from .motion_preview import DIGEST
from .video_assets import SOURCE

AUDIO_SEAMS = "/_internal/v1/video-audio-seams"
PURPOSE = "video.audio-seams.analyze"


class AudioSeamRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    duration_us: int = Field(ge=0, strict=True)
    reference_end_us: int = Field(gt=0, strict=True)
    search_end_us: int = Field(gt=0, strict=True)
    rate: float = Field(ge=0.25, le=4)
    fingerprint: str = Field(pattern="^" + DIGEST + "$")


def audio_target(method, path):
    return method == "POST" and re.fullmatch(rf"{AUDIO_SEAMS}/({ID})/({ID})/({DIGEST})", path)


def audio_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "video",
        PURPOSE,
        "rendering",
        "POST",
    ):
        return False
    match = audio_target(grant.target_method, grant.target_path)
    return bool(
        match and grant.source_path == f"{SOURCE}/projects/{match[1]}/audio-seams/candidates"
    )
