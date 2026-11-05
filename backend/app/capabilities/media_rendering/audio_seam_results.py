"""Typed audio matching result shared by the transport and deterministic engine."""

from pydantic import BaseModel, Field

REFERENCE_US = 2_000_000


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
