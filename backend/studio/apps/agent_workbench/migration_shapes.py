"""The owned historical Workbench records accepted by the migration maintenance lane."""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from studio.apps.agent_workbench.execution.models import (
    WorkbenchChat,
    WorkbenchProject,
    WorkbenchTurn,
)
from studio.apps.agent_workbench.storage.models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchEntry,
    WorkbenchOperation,
    WorkbenchSession,
    WorkbenchSource,
)
from studio.contracts.agent_runtime.definitions import AgentId
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage

ID = r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"
CHANGE_ID = r"^[0-9]{19}$"
Identifier = Annotated[str, Field(pattern=ID)]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, from_attributes=True)


class OwnedRecord(Record):
    id: Identifier


class ProjectRecord(OwnedRecord):
    root: str = Field(min_length=1, max_length=4096)
    last_used_at: int = Field(ge=0)


class ChatRecord(OwnedRecord):
    project_id: str = Field(min_length=1, max_length=100)
    agent_id: AgentId
    created_at: int = Field(ge=0)
    queue_paused: bool


class TurnRecord(OwnedRecord):
    chat_id: Identifier
    client_id: str = Field(min_length=1, max_length=80)
    position: int = Field(ge=1)
    prompt: str = Field(max_length=16_000)
    answer: str = Field(max_length=100_000)
    status: str = Field(min_length=1, max_length=24)
    error: str | None
    approvals: list[dict] = Field(max_length=16)
    revision: int = Field(ge=0)
    started_at: int | None
    queued_session_id: None = None
    queued_local: bool
    activity: list[dict] = Field(max_length=100)
    instructions: list[dict] = Field(max_length=16)


class SourceRecord(OwnedRecord):
    agent_id: AgentId
    label: str = Field(max_length=120)
    root: str = Field(max_length=4096)
    endpoint: str = Field(max_length=255)
    enabled: bool
    revision: int = Field(ge=0)
    status: str = Field(max_length=24)
    message: str = Field(max_length=500)
    last_synced_at: datetime | None
    created_at: datetime


class SessionRecord(OwnedRecord):
    agent_id: AgentId
    native_id: str = Field(min_length=1, max_length=255)
    title: str = Field(max_length=120)
    alias: str = Field(max_length=120)
    favorite: bool
    revision: int = Field(ge=0)
    cwd: str
    origins: list[str]
    evidence: list[str]
    native_model: str = Field(max_length=255)
    parent_native_id: str | None = Field(max_length=255)
    archived: bool
    updated_at: str = Field(max_length=64)
    last_synced_at: datetime


class EntryRecord(OwnedRecord):
    session_id: Identifier
    native_id: str = Field(min_length=1, max_length=255)
    ordinal: int = Field(ge=0)
    role: str = Field(max_length=24)
    kind: str = Field(max_length=32)
    text: str
    timestamp: str = Field(max_length=64)
    parent_id: str | None = Field(max_length=255)
    tool_name: str = Field(max_length=255)
    attachments: list[dict]
    presentation: dict


class CheckpointRecord(OwnedRecord):
    source_id: Identifier
    session_id: Identifier | None
    locator: str
    state: dict
    error: str = Field(max_length=500)


class OperationRecord(OwnedRecord):
    source_id: Identifier
    status: str = Field(max_length=24)
    message: str = Field(max_length=500)
    created_at: datetime


class ChangeRecord(Record):
    id: str = Field(pattern=CHANGE_ID)
    session_id: Identifier | None
    kind: str = Field(max_length=24)
    created_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def format_id(cls, value):
        return f"{value:019d}" if type(value) is int and value > 0 else value


@dataclass(frozen=True)
class HistoryDataset:
    suffix: str
    model: type
    record: type[Record]
    parent: tuple[type, str] | None = None
    key: str = "id"
    page_size: int = 1

    @property
    def name(self):
        return f"agents.{self.suffix}"

    @property
    def batch(self):
        return MigrationBatch[self.record]

    @property
    def page(self):
        return MigrationPage[self.batch]

    @property
    def cursor_pattern(self):
        return CHANGE_ID if self.model is WorkbenchChange else ID

    @property
    def owns_record(self):
        return hasattr(self.model, "owner_user_id")

    @property
    def owner_column(self):
        model = self.parent[0] if not self.owns_record else self.model
        return model.owner_user_id

    def cursor(self, after):
        return int(after or 0) if self.model is WorkbenchChange else after or ""


DATASETS = (
    HistoryDataset("projects", WorkbenchProject, ProjectRecord),
    HistoryDataset("chats", WorkbenchChat, ChatRecord),
    HistoryDataset("turns", WorkbenchTurn, TurnRecord, (WorkbenchChat, "chat_id")),
    HistoryDataset("sources", WorkbenchSource, SourceRecord),
    HistoryDataset("sessions", WorkbenchSession, SessionRecord),
    HistoryDataset("entries", WorkbenchEntry, EntryRecord, (WorkbenchSession, "session_id")),
    HistoryDataset(
        "checkpoints", WorkbenchCheckpoint, CheckpointRecord, (WorkbenchSource, "source_id")
    ),
    HistoryDataset(
        "operations", WorkbenchOperation, OperationRecord, (WorkbenchSource, "source_id")
    ),
    HistoryDataset("changes", WorkbenchChange, ChangeRecord),
)
