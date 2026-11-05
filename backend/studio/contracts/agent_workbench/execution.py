"""Versioned inputs for workbench discovery and exact Mac-side project selection."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from studio.contracts.agent_workbench.native import NativeLease

CATALOG = "workbench.execution.catalog"
DIRECTORIES = "workbench.execution.directories"
REGISTER = "workbench.execution.register"
RUN_TURN = "workbench.execution.run-turn"
CHECK_PROJECT = "workbench.execution.check-project"
PREVIEW_SOURCE = "workbench.execution.preview-source"
DISCOVERY_OPERATIONS = frozenset({CATALOG, DIRECTORIES, REGISTER, CHECK_PROJECT, PREVIEW_SOURCE})
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


Identity = Annotated[str, Field(min_length=1, max_length=80)]


class TurnScope(ProjectCheck):
    chat_id: Identity
    turn_id: Identity


def turn_path(chat):
    return f"{CHATS_PATH}/{chat}/turns"


def decision_path(chat, turn, approval):
    return f"{turn_path(chat)}/{turn}/approvals/{approval}"


Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class Leased(Input):
    lease: NativeLease


class TurnAnswer(Leased):
    text: str = Field(max_length=100_000)


class TurnActivity(Leased):
    kind: Literal["tool_call", "tool_result"]
    payload: dict[str, JsonValue]


class TurnApproval(Leased):
    approval_id: Identity
    action_sha256: Sha256


class TurnProposal(TurnApproval):
    kind: Literal["write", "command"]
    title: str = Field(min_length=1, max_length=500)
    preview: str = Field(max_length=65_536)


class TurnApprovalReceipt(TurnApproval):
    status: Literal["completed", "failed", "unknown"]


class ProjectFile(ProjectCheck):
    path: Annotated[str, Field(min_length=1, max_length=500)]


class ProjectFileResult(Input):
    path: Annotated[str, Field(min_length=1, max_length=500)]
    text: Annotated[str, Field(max_length=131_072)]


def source_path(chat, turn):
    return f"{turn_path(chat)}/{turn}/source"


def queue_resume_path(chat):
    return f"{CHATS_PATH}/{chat}/queue/resume"


def queue_remove_path(chat, turn):
    return f"{CHATS_PATH}/{chat}/queue/{turn}"


def instruction_path(chat, turn):
    return f"{turn_path(chat)}/{turn}/instructions"


class InstructionReceipt(Leased):
    request_id: Identity
    text_sha256: Sha256
    status: Literal["accepted", "rejected", "unknown"]
