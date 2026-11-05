from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.capabilities.agents.activity import ActivityDetails
from app.capabilities.agents.sessions.contracts import AgentId


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkbenchSourceCreate(StrictInput):
    agent_id: AgentId
    label: str = Field(min_length=1, max_length=120)
    root: str = Field(default="", max_length=4096)
    endpoint: str = Field(default="", max_length=255)


class WorkbenchSourcePatch(StrictInput):
    expected_revision: int = Field(ge=0)
    enabled: bool | None = None
    label: str | None = Field(default=None, min_length=1, max_length=120)


class WorkbenchPreferences(StrictInput):
    expected_revision: int = Field(ge=0)
    alias: str | None = Field(default=None, max_length=120)
    favorite: bool | None = None


class WorkbenchSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    agent_id: AgentId
    label: str
    root: str
    endpoint: str
    enabled: bool
    revision: int
    status: str
    message: str
    last_synced_at: datetime | None
    sync_mode: Literal["log_follow", "native_events", "api_poll"] = "log_follow"


class WorkbenchCandidate(BaseModel):
    agent_id: AgentId
    label: str
    root: str
    exists: bool


class WorkbenchSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    agent_id: AgentId
    native_id: str
    title: str
    alias: str
    favorite: bool
    revision: int
    cwd: str
    origins: list[str]
    evidence: list[str]
    native_model: str
    parent_native_id: str | None
    archived: bool
    updated_at: str
    last_synced_at: datetime
    source_ids: list[str] = Field(default_factory=list)
    source_errors: list[str] = Field(default_factory=list)
    can_send: Literal[False] = False
    continuation_reason: str = "当前支持查看与同步，继续对话待接入"


class WorkbenchSessionPage(BaseModel):
    items: list[WorkbenchSessionOut]
    next_cursor: str | None
    change_cursor: int


class HistoryBlock(BaseModel):
    details: ActivityDetails | None = None
    kind: str
    text: str
    tool_name: str = ""
    call_id: str | None = None
    status: str | None = None


class HistoryPresentation(BaseModel):
    details: ActivityDetails | None = None
    turn_id: str | None = None
    message_id: str | None = None
    call_id: str | None = None
    status: str | None = None
    blocks: list[HistoryBlock] = Field(default_factory=list)


class WorkbenchEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    native_id: str
    ordinal: int
    role: str
    kind: str
    text: str
    timestamp: str
    parent_id: str | None
    tool_name: str
    attachments: list[dict]
    presentation: HistoryPresentation = Field(default_factory=HistoryPresentation)


class WorkbenchHistory(BaseModel):
    items: list[WorkbenchEntryOut]
    next_cursor: int | None
    next_cursor_native_id: str | None = None
    change_cursor: int
    branches: list[str] = Field(default_factory=list)
    selected_branch: str | None = None


class WorkbenchOperationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    source_id: str
    status: str
    message: str


class WorkbenchEvent(BaseModel):
    sequence: int
    kind: Literal["source", "session", "reset", "ready", "auth_expired"]
    session_id: str | None = None
