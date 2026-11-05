"""Fixed Amadeus Mac worker operation and conversation scope."""

import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

FINDER = "amadeus.conversation.reveal"
SCRIPT = "amadeus.script.run"
DIALOGUE = "amadeus.dialogue.run"
RUN_PATH = "/v1/amadeus/conversations/{conversation_id}/runs"
RUN_SOURCE = re.compile(r"/v1/amadeus/conversations/[A-Za-z0-9_-]{1,128}/runs")
AgentName = Literal["codex", "claude-code", "opencode", "dsh", "pi"]
Signature = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
EXECUTE_PATH = "/v1/amadeus/conversations/{conversation_id}/actions/{action_id}/execute"
OPEN_PATH = "/v1/amadeus/conversations/{conversation_id}/files/open-folder"


class FinderScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    conversation_id: UUID

    @property
    def path(self):
        return OPEN_PATH.format(conversation_id=self.conversation_id)


class AmadeusPoll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: Annotated[float, Field(ge=0, le=4)] = 1
    sandbox_available: bool
    dialogue: bool = False
    agents: dict[AgentName, Signature] = Field(default_factory=dict)


class PythonScript(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["python"]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ShellScript(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["shell"]
    command: Annotated[str, Field(min_length=1, max_length=20_000)]
    sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ScriptScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    conversation_id: UUID
    action_id: UUID
    script: Annotated[PythonScript | ShellScript, Field(discriminator="kind")]

    @property
    def path(self):
        return EXECUTE_PATH.format(conversation_id=self.conversation_id, action_id=self.action_id)


class ScriptResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    exit_code: Annotated[int, Field(strict=True)]
    output: Annotated[str, Field(max_length=1024 * 1024)]
    truncated: Annotated[bool, Field(strict=True)]


class DialogueScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    conversation_id: UUID
    run_id: UUID
    agent: AgentName
    model: Annotated[str, Field(max_length=160)]
    signature: Signature

    @property
    def path(self):
        return RUN_PATH.format(conversation_id=self.conversation_id)


class DialoguePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: Annotated[str, Field(min_length=1, max_length=400_000)]


class DialogueToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=64)]
    arguments: dict


class DialogueToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result: object
    paused: bool = False
