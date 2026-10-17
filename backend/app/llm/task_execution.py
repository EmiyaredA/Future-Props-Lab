"""Provider-neutral execution telemetry; it never determines task completion."""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaskExecutionInfo(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    phase: Literal["queued", "running", "finalizing", "unknown"] = "unknown"
    queue_position: int | None = Field(default=None, ge=1)
    node_id: str | None = Field(default=None, max_length=128)
    node_label: str | None = Field(default=None, max_length=128)
    step: int | None = Field(default=None, ge=0)
    total_steps: int | None = Field(default=None, ge=1)
    reported_progress: float | None = Field(default=None, ge=0, le=100)
    updated_at: datetime
    live_status: Literal["unavailable", "connecting", "connected", "reconnecting"] = "unavailable"
    last_event_at: datetime | None = None

    @field_validator("updated_at", "last_event_at")
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        # Runtime/database clocks use naive UTC; public timestamps must carry a zone.
        return value.replace(tzinfo=UTC) if value and value.tzinfo is None else value
