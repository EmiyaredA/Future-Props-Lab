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
    created_at: datetime


class ConversationDetailOut(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]
    actions: list[ActionOut] = Field(default_factory=list)


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


class ActionOut(BaseModel):
    id: str
    tool_name: str
    arguments: dict[str, Any]
    arguments_sha256: str
    status: str
    result: dict[str, Any] | None
    created_at: datetime


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
