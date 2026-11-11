from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class VideoEnhancementIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=64)
    source_id: str = Field(min_length=1, max_length=36)
    model_id: str = Field(min_length=1, max_length=36)


class VideoEnhancementAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["pause", "resume"]
    expected_revision: int = Field(ge=0)


class VideoEnhancementSegment(BaseModel):
    index: int
    start_seconds: float
    end_seconds: float
    result_url: str | None
    original_url: str | None


class VideoEnhancementOut(BaseModel):
    id: str
    model_id: str
    filename: str
    status: Literal[
        "queued",
        "analyzing",
        "running",
        "pausing",
        "paused",
        "interrupted",
        "combining",
        "completed",
        "failed",
    ]
    completed: int
    revision: int
    error_message: str | None
    segments: list[VideoEnhancementSegment]
    result_url: str | None
