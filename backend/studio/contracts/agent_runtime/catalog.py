"""Public CLI connection shapes, independent of probe execution and account storage."""

from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.agent_runtime.definitions import AgentId

ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
REASONING_EFFORTS = frozenset(get_args(ReasoningEffort))
PI_REASONING_EFFORTS = ("low", "medium", "high", "xhigh")

# Happier 2aeb139d, packages/agents/src/providers/claude/effort.ts (MIT).
_CLAUDE_BASIC_EFFORTS = ("low", "medium", "high")
CLAUDE_MODEL_EFFORTS = {
    model: (*_CLAUDE_BASIC_EFFORTS, "xhigh", "max")
    for model in (
        "claude-fable-5-1",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-fable-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
    )
}
CLAUDE_MODEL_EFFORTS.update(
    {
        "claude-opus-4-6": (*_CLAUDE_BASIC_EFFORTS, "max"),
        "claude-sonnet-4-6": _CLAUDE_BASIC_EFFORTS,
        "claude-opus-4-5": _CLAUDE_BASIC_EFFORTS,
    }
)


def accepts_reasoning_effort(agent: str, model: str, effort: ReasoningEffort) -> bool:
    if not model or model == "default":
        return False
    if agent == "codex":
        return True  # The native runner rechecks the model's current discovery response.
    if agent == "pi":
        return effort in PI_REASONING_EFFORTS
    if agent == "claude-code":
        return effort in CLAUDE_MODEL_EFFORTS.get(model.removesuffix("[1m]"), ())
    return False


OptionId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,79}$")]
ModelId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._+:/@-]{0,159}$")]


class TurnOptions(BaseModel):
    reasoning_effort: ReasoningEffort | None = None
    model_variant: OptionId | None = None
    harness_effort: OptionId | None = None
    service_tier: Literal["fast"] | None = None

    def cli_options(self):
        return self.model_dump(include=set(TurnOptions.model_fields), exclude_none=True)


class TokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    cached_input_tokens: int | None = Field(default=None, ge=0)
    cache_write_tokens: int | None = Field(default=None, ge=0)
    reasoning_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)
    context_used: int | None = Field(default=None, ge=0)
    context_limit: int | None = Field(default=None, gt=0)


class NamedOption(BaseModel):
    id: OptionId
    label: str = Field(max_length=160)


class ModelOption(BaseModel):
    id: str
    label: str
    reasoning_efforts: list[ReasoningEffort] = Field(default_factory=list)
    variants: list[NamedOption] = Field(default_factory=list, max_length=100)
    fast_available: bool = False


class AgentOut(BaseModel):
    id: AgentId
    name: str
    executable: str
    version: str
    enabled: bool
    available: bool
    status: str
    message: str
    models: list[ModelOption] = Field(default_factory=list)
    harness_options_model: ModelId | None = None
    harness_efforts: list[NamedOption] = Field(default_factory=list, max_length=100)
    model_catalog: Literal["not_checked", "discovered", "preset", "unavailable"] = "not_checked"


class CatalogOut(BaseModel):
    items: list[AgentOut]
    can_enable: bool = False
