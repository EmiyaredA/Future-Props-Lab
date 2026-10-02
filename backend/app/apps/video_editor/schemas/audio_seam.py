from __future__ import annotations

from pydantic import BaseModel, Field


class AudioSeamCandidatesIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    from_clip_id: str = Field(alias="fromClipId", min_length=1, max_length=64)
    to_clip_id: str = Field(alias="toClipId", min_length=1, max_length=64)


class AudioSeamCandidateOut(BaseModel):
    source_in_us: int = Field(alias="sourceInUs")
    suggested_fade_us: int = Field(alias="suggestedFadeUs")
    match_reasons: list[str] = Field(alias="matchReasons")
    peaks: list[float]


class AudioSeamCandidatesOut(BaseModel):
    asset_id: str = Field(alias="assetId")
    reference_start_us: int = Field(alias="referenceStartUs")
    reference_peaks: list[float] = Field(alias="referencePeaks")
    candidates: list[AudioSeamCandidateOut]
