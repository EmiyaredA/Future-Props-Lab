"""Only frozen Interview inputs and bounded events cross the native worker boundary."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.apps.interview_assistant.schemas import InterviewInputSnapshot, PreparationBundle

OPERATION = "interview.prepare"
PERMISSION = "content.write"
DIGEST = r"^[a-f0-9]{64}$"


class WorkerStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    available: bool
    code: str = Field(pattern=r"^[a-z_]{1,64}$")
    version: str = Field(default="", pattern=r"^[a-zA-Z0-9._+ -]{0,60}$")


class ExecutionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: UUID
    room_id: UUID
    input_hash: str = Field(pattern=DIGEST)
    snapshot: InterviewInputSnapshot


class ExecutionEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["started", "search", "material", "validating", "accepted"]
    message: str = Field(max_length=500)
    urls: list[str] = Field(default_factory=list, max_length=20)


class ExecutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    state: Literal["succeeded", "needs_input"]
    bundle: PreparationBundle
    message: str = Field(max_length=1000)
