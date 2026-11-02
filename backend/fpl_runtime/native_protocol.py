"""Versioned native task envelopes. Credentials never appear in task payloads."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class NativeLease(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: UUID
    lease_id: UUID
    owner_user_id: str = Field(min_length=1, max_length=100)
    operation: str = Field(pattern=r"^[a-z][a-z0-9_.-]{0,80}$")
    payload: dict[str, JsonValue]
    lease_expires_at: str


class NativeOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "failed", "unknown"]
    result: dict[str, JsonValue] = Field(default_factory=dict)
    error_code: str = Field(default="", max_length=100)
    message: str = Field(default="", max_length=1000)


COLLECTOR_OPERATIONS = frozenset(
    {
        "agent_sources.candidates",
        "agent_sources.validate",
        "agent_sources.discover",
        "agent_sources.watch",
        "agent_sources.attachment",
        "agent_sources.follow",
    }
)
