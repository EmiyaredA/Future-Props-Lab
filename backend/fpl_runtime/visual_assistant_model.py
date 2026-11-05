"""Private model turns for Visual's owned assistant harness."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, model_validator

from app.capabilities.agents.harness.contracts import (
    AgentMessage,
    ModelTextDelta,
    ModelTurnEnd,
    ModelUsageUpdate,
    ToolCall,
    ToolSpec,
    Usage,
)

from .library_assets import ID
from .motion_preview import sha256
from .visual_assistant import MODEL_RUNS

MAX_ROUND_BYTES = 256 * 1024**2
Identity = Annotated[str, Field(pattern=rf"^{ID}$")]


class RunScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: Identity
    conversation_id: Identity
    run_id: Identity

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    def target(self, verb):
        root = f"{MODEL_RUNS}/{self.project_id}/{self.conversation_id}/{self.run_id}"
        return f"{root}/{verb}/{self.digest}"


class AssistantRunStart(RunScope):
    model_id: Identity
    trace_id: Identity
    require_vision: bool
    tools_enabled: bool
    request_summary: dict[str, JsonValue]

    @property
    def path(self):
        return self.target("begin")


class AssistantModelPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Identity
    model_slug: str
    provider_kind: str
    tools_enabled: bool


class AssistantRound(RunScope):
    index: int = Field(ge=0, lt=6, strict=True)
    system: str = Field(max_length=100_000)
    messages: list[AgentMessage] = Field(min_length=1)
    tools: list[ToolSpec] = Field(max_length=32)
    temperature: float = Field(ge=0, le=2)
    max_tokens: int = Field(ge=1, le=32768, strict=True)

    @property
    def path(self):
        return self.target(f"round/{self.index}")

    @model_validator(mode="after")
    def conversation_roles(self):
        if any(
            message.role not in {"user", "assistant", "tool"}
            or (message.role != "user" and message.images)
            or (message.role != "assistant" and message.tool_calls)
            or (message.role == "tool" and not message.tool_call_id)
            for message in self.messages
        ):
            raise ValueError("对话轮次消息结构无效")
        if len({tool.name for tool in self.tools}) != len(self.tools):
            raise ValueError("对话工具标识重复")
        return self


class AssistantRunSettle(RunScope):
    status: Literal["completed", "error", "cancelled"]
    run_status: str = Field(max_length=40)
    error_message: str | None = Field(default=None, max_length=1000)
    actions: list[dict[str, JsonValue]] = Field(default_factory=list, max_length=96)
    first_token_latency_ms: int | None = Field(default=None, ge=0)
    finish_reason: str = Field(max_length=64)

    @property
    def path(self):
        return self.target("settle")


class TextEvent(BaseModel):
    type: Literal["text"] = "text"
    text: str


class UsageEvent(BaseModel):
    type: Literal["usage"] = "usage"
    usage: Usage


class TurnEvent(BaseModel):
    type: Literal["turn"] = "turn"
    tool_calls: tuple[ToolCall, ...]
    usage: Usage


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    error: str


MODEL_EVENTS = TypeAdapter(
    Annotated[TextEvent | UsageEvent | TurnEvent | ErrorEvent, Field(discriminator="type")]
)


def from_model(event):
    if isinstance(event, ModelTextDelta):
        return TextEvent(text=event.text)
    if isinstance(event, ModelUsageUpdate):
        return UsageEvent(usage=event.usage)
    if isinstance(event, ModelTurnEnd):
        return TurnEvent(tool_calls=event.tool_calls, usage=event.usage)
    raise TypeError("未知模型轮次事件")
