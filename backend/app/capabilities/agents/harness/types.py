from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, Protocol

from app.capabilities.agents.harness.contracts import AgentMessage, ToolCall, ToolSpec, Usage

ToolEffect = Literal["read", "write", "external"]
PolicyDecisionKind = Literal["allow", "deny", "require_approval"]
CompletionDecisionKind = Literal["complete", "continue", "fail"]


class RunStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    BUDGET_EXHAUSTED = "budget_exhausted"


@dataclass(frozen=True)
class RunBudgets:
    max_rounds: int = 6
    max_tool_failures: int = 3
    model_turn_timeout_seconds: float = 120.0
    approval_timeout_seconds: float = 300.0
    context_characters: int = 32_000
    tool_result_characters: int = 12_000


@dataclass(frozen=True)
class ContextFragment:
    source: str
    content: str
    priority: int = 0
    character_budget: int | None = None


@dataclass(frozen=True)
class PolicyDecision:
    decision: PolicyDecisionKind
    reason: str = ""


@dataclass(frozen=True)
class CompletionDecision:
    decision: CompletionDecisionKind
    reason: str = ""
    feedback: str = ""


@dataclass(frozen=True)
class ToolExecutionContext:
    run_id: str
    tool_call_id: str
    scope: dict[str, Any]
    approved_canvas_revision: int | None = None


@dataclass(frozen=True)
class Observation:
    action_id: str
    tool_name: str
    success: bool
    model_text: str
    data: dict[str, Any] = field(default_factory=dict)
    error_code: str = ""
    retryable: bool = False
    duration_ms: int = 0


ToolHandler = Callable[[dict[str, Any], ToolExecutionContext], Awaitable[Observation]]
ToolSummary = Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class ToolBinding:
    name: str
    description: str
    input_schema: dict[str, Any]
    effect: ToolEffect
    handler: ToolHandler
    summarize: ToolSummary
    timeout_seconds: float = 30.0

    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            description=self.description,
            parameters_schema=self.input_schema,
        )


class AgentPolicy(Protocol):
    async def evaluate(
        self,
        binding: ToolBinding,
        arguments: dict[str, Any],
        scope: dict[str, Any],
    ) -> PolicyDecision: ...


class CompletionVerifier(Protocol):
    async def verify(
        self,
        *,
        final_text: str,
        observations: tuple[Observation, ...],
        round_index: int,
    ) -> CompletionDecision: ...


class DefaultPolicy:
    async def evaluate(
        self,
        binding: ToolBinding,
        arguments: dict[str, Any],
        scope: dict[str, Any],
    ) -> PolicyDecision:
        del arguments, scope
        if binding.effect == "read":
            return PolicyDecision("allow")
        return PolicyDecision("require_approval", "写入和外部操作需要用户确认")


class DefaultCompletionVerifier:
    async def verify(
        self,
        *,
        final_text: str,
        observations: tuple[Observation, ...],
        round_index: int,
    ) -> CompletionDecision:
        del round_index
        if observations and not observations[-1].success and observations[-1].retryable:
            return CompletionDecision(
                "continue",
                "最近一次工具结果要求重新规划",
                "最近一次工具返回了可重试冲突。请重新读取必要状态、重新规划，"
                "不要把未执行的操作描述为已完成。",
            )
        if final_text.strip():
            return CompletionDecision("complete", "已通过完成性验证")
        return CompletionDecision(
            "continue",
            "模型未返回最终文本",
            "请根据已经完成的工具结果给出简洁、准确的最终答复。",
        )


ContextSource = Callable[[], Awaitable[list[ContextFragment]]]


@dataclass(frozen=True)
class AgentDefinition:
    id: str
    model: str
    instructions: str
    tools: tuple[ToolBinding, ...] = ()
    context_sources: tuple[ContextSource, ...] = ()
    policy: AgentPolicy = field(default_factory=DefaultPolicy)
    verifier: CompletionVerifier = field(default_factory=DefaultCompletionVerifier)
    budgets: RunBudgets = field(default_factory=RunBudgets)
    temperature: float = 0.7
    max_tokens: int = 2048


@dataclass(frozen=True)
class AgentEvent:
    type: str
    run_id: str
    round_index: int = 0
    payload: dict[str, Any] = field(default_factory=dict)


EventListener = Callable[[AgentEvent], Awaitable[None] | None]


@dataclass(frozen=True)
class RunResult:
    run_id: str
    status: RunStatus
    final_text: str
    messages: tuple[AgentMessage, ...]
    observations: tuple[Observation, ...]
    usage: Usage
    reason: str = ""


@dataclass(frozen=True)
class ProposedAction:
    call: ToolCall
    binding: ToolBinding
    arguments: dict[str, Any]
    summary: dict[str, Any]
    policy: PolicyDecision


class AgentStrategy(Protocol):
    async def run(
        self,
        *,
        messages: list[AgentMessage],
        user_text: str,
        listener: EventListener | None = None,
    ) -> RunResult: ...


class EventStore(Protocol):
    async def append(self, event: AgentEvent) -> None: ...


class SkillProvider(Protocol):
    async def tools(self, scope: dict[str, Any]) -> tuple[ToolBinding, ...]: ...
