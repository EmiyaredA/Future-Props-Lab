"""Versioned inputs for workbench discovery and exact Mac-side project selection."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

CATALOG = "workbench.execution.catalog"
DIRECTORIES = "workbench.execution.directories"
REGISTER = "workbench.execution.register"
CHECK_PROJECT = "workbench.execution.check-project"
DISCOVERY_OPERATIONS = frozenset({CATALOG, DIRECTORIES, REGISTER, CHECK_PROJECT})
CATALOG_PATH = "/v1/agent-workbench/execution/catalog"
DIRECTORY_PATH = "/v1/agent-workbench/execution/directories"
PROJECT_PATH = "/v1/agent-workbench/execution/projects"
CHATS_PATH = "/v1/agent-workbench/chats"

Root = Annotated[str, Field(min_length=1, max_length=4096)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DirectoryQuery(Input):
    parent: Annotated[str, Field(max_length=4096)] | None = None


class RegisterProject(Input):
    root: Root


class RecentRoot(Input):
    id: Annotated[str, Field(min_length=1, max_length=80)]
    root: Root


class Discovery(Input):
    local: bool
    recent: Annotated[list[RecentRoot], Field(max_length=20)] = Field(default_factory=list)


ROUTES = {
    CATALOG: ("GET", CATALOG_PATH),
    DIRECTORIES: ("GET", DIRECTORY_PATH),
    REGISTER: ("POST", PROJECT_PATH),
    CHECK_PROJECT: ("POST", CHATS_PATH),
}


class ProjectCheck(Input):
    project_id: Annotated[str, Field(min_length=1, max_length=80)]
    agent: Literal["codex", "claude-code", "opencode", "dsh", "pi"]
    local: bool
    registered_root: Root | None = None


class ProjectReady(Input):
    project_id: Annotated[str, Field(min_length=1, max_length=80)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    agent_signature: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    project_signature: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
