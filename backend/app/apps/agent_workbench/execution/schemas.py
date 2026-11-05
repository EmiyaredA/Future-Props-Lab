from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.capabilities.agents.activity import ActivityDetails
from app.capabilities.agents.cli.catalog import AgentId


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatCreate(Input):
    project_id: str = Field(min_length=1, max_length=80)
    agent_id: AgentId


class TurnCreate(Input):
    mode: Literal["immediate", "queue"] = "immediate"
    request_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=16000, pattern=r"\S")


class InstructionCreate(Input):
    request_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=16000, pattern=r"\S")


class InstructionOut(BaseModel):
    request_id: str
    text: str
    status: Literal["sending", "accepted", "rejected", "unknown"]
    offset: int
    sequence: int | None = None


class TurnActivity(BaseModel):
    call_id: str
    name: str
    offset: int
    status: Literal["running", "completed", "failed", "unknown"]
    details: ActivityDetails | None = None
    source_available: bool = False
    sequence: int | None = None


class SourcePreview(BaseModel):
    path: str
    text: str
    line: int | None = None
    diff: str | None = None


class ApprovalDecision(Input):
    approved: bool


class ProjectChoice(BaseModel):
    id: str
    label: str


class ProjectDirectory(Input):
    root: str = Field(min_length=1, max_length=4096)


class DirectoryChoice(BaseModel):
    root: str
    label: str


class RecentProject(ProjectChoice):
    root: str


class DirectoryListing(BaseModel):
    parent: str | None
    selectable: bool
    items: list[DirectoryChoice]


class AgentChoice(ProjectChoice):
    id: AgentId
    available: bool
    status: str


class ExecutionCatalog(BaseModel):
    enabled: bool
    projects: list[ProjectChoice]
    agents: list[AgentChoice]
    can_select_directory: bool = False
    recent_projects: list[RecentProject] = Field(default_factory=list)
    suggested_directories: list[DirectoryChoice] = Field(default_factory=list)


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    agent_id: AgentId
    created_at: int
    project_label: str | None = None


class ApprovalOut(BaseModel):
    id: str
    kind: Literal["write", "command"]
    title: str
    preview: str
    status: str
    offset: int | None = None
    sequence: int | None = None


class TurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    position: int
    prompt: str
    answer: str
    status: str
    error: str | None
    approvals: list[ApprovalOut]
    revision: int
    started_at: int | None = None
    activity: list[TurnActivity] = Field(default_factory=list)
    instructions: list[InstructionOut] = Field(default_factory=list)


class QueuedTurn(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    prompt: str


class ChatDetail(ChatOut):
    turns: list[TurnOut]
    queue: list[QueuedTurn] = Field(default_factory=list)
    queue_paused: bool = False
    steerable_turn_id: str | None = None
