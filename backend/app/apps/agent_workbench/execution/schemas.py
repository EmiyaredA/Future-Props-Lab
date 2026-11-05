from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.capabilities.agents.cli.catalog import AgentId


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatCreate(Input):
    project_id: str = Field(min_length=1, max_length=80)
    agent_id: AgentId


class TurnCreate(Input):
    request_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=16000, pattern=r"\S")


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


class ChatDetail(ChatOut):
    turns: list[TurnOut]
