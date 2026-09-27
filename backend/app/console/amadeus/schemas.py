from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Reference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=120)
    window_id: int | None = None
    application: str = Field(max_length=120)
    name: str = Field(max_length=200)
    value: str = Field(default="", max_length=2000)
    source: str = Field(default="", max_length=500)
    thumbnail: str | None = Field(default=None, max_length=400_000)


class ConversationOut(BaseModel):
    id: str
    title: str
    model_id: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class ConversationListOut(BaseModel):
    items: list[ConversationOut]


class ConversationPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model_id: str | None = None


class MessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant", "tool"]
    content: str
    references: list[Reference]
    run_id: str | None = None
    status: str = "completed"
    created_at: datetime


class ConversationDetailOut(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]
    actions: list[ActionOut] = Field(default_factory=list)
    questions: list[QuestionOut] = Field(default_factory=list)


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    role: Literal["user", "assistant", "tool"]
    content: str = Field(min_length=1, max_length=100_000)
    references: list[Reference] = Field(default_factory=list, max_length=20)


class ActionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_name: str = Field(min_length=1, max_length=120)
    arguments: dict[str, Any] = Field(default_factory=dict)
    run_id: str | None = None


class ActionOut(BaseModel):
    id: str
    tool_name: str
    arguments: dict[str, Any]
    arguments_sha256: str
    status: str
    result: dict[str, Any] | None
    run_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ActionDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    arguments_sha256: str = Field(min_length=64, max_length=64)
    approve: bool


class ModelTurnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    system: str = Field(max_length=100_000)
    messages: list[dict[str, Any]] = Field(min_length=1, max_length=200)
    tools: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    run_id: str | None = None
    subagent_id: str | None = Field(default=None, max_length=120)


class RunCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str = Field(min_length=1, max_length=160)
    mode: Literal["agent", "plan"] = "agent"
    source_run_id: str | None = None
    context: list[dict[str, Any]] = Field(default_factory=list, max_length=32)
    references: list[Reference] = Field(default_factory=list, max_length=20)
    capabilities: list[str] = Field(default_factory=list, max_length=100)


class RunEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal[
        "assistant_delta",
        "assistant_message",
        "tool_call",
        "tool_result",
        "status",
        "error",
        "question",
        "subagent_start",
        "subagent_finish",
    ]
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=1, max_length=120)


class RunFinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "failed", "cancelled", "interrupted"]
    error_message: str | None = Field(default=None, max_length=4000)


class RunEventOut(BaseModel):
    id: str
    run_id: str
    sequence: int
    kind: str
    payload: dict[str, Any]
    idempotency_key: str
    created_at: datetime


class RunOut(BaseModel):
    id: str
    conversation_id: str
    model_id: str
    mode: Literal["agent", "plan"]
    source_run_id: str | None
    status: str
    context: list[dict[str, Any]]
    references: list[Reference]
    capabilities: list[str]
    partial_text: str
    heartbeat_at: datetime
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class RunDetailOut(BaseModel):
    run: RunOut
    events: list[RunEventOut]


class QuestionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_call_id: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(default_factory=list, max_length=5)
    allow_text: bool = True


class QuestionAnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str = Field(min_length=1, max_length=2000)
    note: str = Field(default="", max_length=2000)


class QuestionOut(BaseModel):
    id: str
    run_id: str
    tool_call_id: str
    prompt: str
    options: list[str]
    allow_text: bool
    status: str
    answer: dict[str, str] | None
    created_at: datetime
    updated_at: datetime


class ModelTurnOut(BaseModel):
    text: str
    tool_calls: list[dict[str, Any]]
    usage: dict[str, int | None]


class FileOut(BaseModel):
    kind: str
    name: str
    bytes: int
    sha256: str


class FileListOut(BaseModel):
    items: list[FileOut]


class FileWriteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(max_length=100_000)
    expected_sha256: str = Field(default="", max_length=64)
