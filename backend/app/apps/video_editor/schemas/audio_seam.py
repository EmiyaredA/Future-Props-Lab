from __future__ import annotations

from pydantic import BaseModel, Field

from app.capabilities.media_rendering.audio_seam_results import (
    AudioSeamCandidateOut as AudioSeamCandidateOut,
)
from app.capabilities.media_rendering.audio_seam_results import (
    AudioSeamCandidatesOut as AudioSeamCandidatesOut,
)


class AudioSeamCandidatesIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    from_clip_id: str = Field(alias="fromClipId", min_length=1, max_length=64)
    to_clip_id: str = Field(alias="toClipId", min_length=1, max_length=64)
