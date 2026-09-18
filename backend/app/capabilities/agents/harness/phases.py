from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import uuid4

from app.capabilities.agents.harness.approval import ApprovalBroker
from app.capabilities.agents.harness.context import ContextCompiler
from app.capabilities.agents.harness.contracts import (
    AgentMessage,
    ModelAdapter,
    ModelTextDelta,
    ModelTurnEnd,
)
from app.capabilities.agents.harness.types import (
    AgentDefinition,
    AgentEvent,
    EventListener,
    Observation,
    ProposedAction,
    ToolBinding,
    ToolExecutionContext,
)


async def emit_event(listener: EventListener | None, event: AgentEvent) -> None:
    if listener is None:
        return
    result = listener(event)
    if inspect.isawaitable(result):
        await result


async def compile_context_phase(
    definition: AgentDefinition,
    *,
    listener: EventListener,
    run_id: str,
    round_index: int,
) -> str:
    fragments = []
    for source in definition.context_sources:
        fragments.extend(await source())
    context, summary = ContextCompiler(definition.budgets.context_characters).compile(fragments)
    await emit_event(listener, AgentEvent("context_compiled", run_id, round_index, summary))
    return f"{definition.instructions}\n\n{context}" if context else definition.instructions


async def model_turn_phase(
    adapter: ModelAdapter,
    definition: AgentDefinition,
    *,
    messages: list[AgentMessage],
    tool_specs: list[dict[str, object]],
    listener: EventListener,
    run_id: str,
    round_index: int,
    abort: asyncio.Event,
) -> tuple[str, ModelTurnEnd]:
    system_prompt = await compile_context_phase(
        definition,
        listener=listener,
        run_id=run_id,
        round_index=round_index,
    )
    await emit_event(listener, AgentEvent("model_started", run_id, round_index))
    text: list[str] = []
    turn_end: ModelTurnEnd | None = None
    try:
        async with asyncio.timeout(definition.budgets.model_turn_timeout_seconds):
            async for event in adapter.stream_turn(
                system=system_prompt,
                messages=messages,
                tools=tool_specs,
                model=definition.model,
                temperature=definition.temperature,
                max_tokens=definition.max_tokens,
                round_index=round_index,
            ):
                if abort.is_set():
                    raise asyncio.CancelledError
                if isinstance(event, ModelTextDelta):
                    text.append(event.text)
                    await emit_event(
                        listener,
                        AgentEvent("model_text_delta", run_id, round_index, {"text": event.text}),
                    )
                else:
                    turn_end = event
    except TimeoutError as exc:
        raise RuntimeError("model_turn_timeout") from exc
    completed = turn_end or ModelTurnEnd()
    await emit_event(
        listener,
        AgentEvent(
            "model_completed",
            run_id,
            round_index,
            {"tool_call_count": len(completed.tool_calls)},
        ),
    )
    return "".join(text), completed


@dataclass(frozen=True, slots=True)
class ToolProposalBatch:
    actions: tuple[ProposedAction, ...]
    unavailable: tuple[Observation, ...]


async def propose_tools_phase(
    definition: AgentDefinition,
    calls,
    *,
    tools: Mapping[str, ToolBinding],
    scope: dict[str, object],
    listener: EventListener,
    run_id: str,
    round_index: int,
) -> ToolProposalBatch:
    actions: list[ProposedAction] = []
    unavailable: list[Observation] = []
    for call in calls:
        binding = tools.get(call.name)
        if binding is None:
            unavailable.append(
                Observation(
                    call.id,
                    call.name,
                    False,
                    "工具不存在或当前不可用。",
                    error_code="tool_unavailable",
                )
            )
            continue
        policy = await definition.policy.evaluate(binding, call.arguments, scope)
        action = ProposedAction(
            call=call,
            binding=binding,
            arguments=dict(call.arguments),
            summary=binding.summarize(call.arguments),
            policy=policy,
        )
        actions.append(action)
        await emit_event(
            listener,
            AgentEvent(
                "tool_proposed",
                run_id,
                round_index,
                {
                    "action_id": call.id,
                    "tool_name": binding.name,
                    "effect": binding.effect,
                    "summary": action.summary,
                    "policy": policy.decision,
                    "policy_reason": policy.reason,
                },
            ),
        )
    return ToolProposalBatch(tuple(actions), tuple(unavailable))


async def execute_tool_phase(
    action: ProposedAction,
    *,
    listener: EventListener,
    run_id: str,
    round_index: int,
    scope: dict[str, object],
    approved_canvas_revision: int | None,
) -> Observation:
    started = time.perf_counter()
    await emit_event(
        listener,
        AgentEvent(
            "tool_started",
            run_id,
            round_index,
            {
                "action_id": action.call.id,
                "tool_name": action.binding.name,
                "effect": action.binding.effect,
                "summary": action.summary,
            },
        ),
    )
    try:
        async with asyncio.timeout(action.binding.timeout_seconds):
            result = await action.binding.handler(
                action.arguments,
                ToolExecutionContext(
                    run_id=run_id,
                    tool_call_id=action.call.id,
                    scope=scope,
                    approved_canvas_revision=approved_canvas_revision,
                ),
            )
    except TimeoutError:
        result = Observation(
            action.call.id,
            action.binding.name,
            False,
            "工具执行超时。",
            error_code="tool_timeout",
            retryable=True,
        )
    except Exception as exc:  # noqa: BLE001
        result = Observation(
            action.call.id,
            action.binding.name,
            False,
            f"工具执行失败：{str(exc)[:1000]}",
            error_code="tool_failed",
            retryable=False,
        )
    elapsed = max(0, round((time.perf_counter() - started) * 1000))
    observation = Observation(
        action_id=result.action_id,
        tool_name=result.tool_name,
        success=result.success,
        model_text=result.model_text,
        data=result.data,
        error_code=result.error_code,
        retryable=result.retryable,
        duration_ms=elapsed,
    )
    await emit_event(
        listener,
        AgentEvent(
            "tool_completed" if observation.success else "tool_failed",
            run_id,
            round_index,
            {
                "action_id": action.call.id,
                "tool_name": action.binding.name,
                "effect": action.binding.effect,
                "summary": action.summary,
                "observation": observation.data,
                "model_text": observation.model_text,
                "error_code": observation.error_code,
                "duration_ms": elapsed,
            },
        ),
    )
    return observation


async def approval_phase(
    actions: list[ProposedAction],
    *,
    approvals: ApprovalBroker,
    listener: EventListener,
    run_id: str,
    round_index: int,
    scope: dict[str, object],
    timeout_seconds: float,
) -> list[Observation]:
    approval_id = str(uuid4())
    proposal_revision = int(scope.get("canvas_revision") or 0)
    await emit_event(
        listener,
        AgentEvent(
            "approval_requested",
            run_id,
            round_index,
            {
                "approval_id": approval_id,
                "canvas_revision": proposal_revision,
                "actions": [
                    {
                        "action_id": item.call.id,
                        "tool_name": item.binding.name,
                        "effect": item.binding.effect,
                        "summary": item.summary,
                    }
                    for item in actions
                ],
            },
        ),
    )
    try:
        resolution = await approvals.wait(
            run_id=run_id,
            approval_id=approval_id,
            scope=scope,
            proposal_canvas_revision=proposal_revision,
            timeout_seconds=timeout_seconds,
        )
    except TimeoutError:
        resolution = None
    decision = resolution.decision if resolution else "reject"
    await emit_event(
        listener,
        AgentEvent(
            "approval_resolved",
            run_id,
            round_index,
            {
                "approval_id": approval_id,
                "decision": decision,
                "reason": "审批已超时" if resolution is None else "",
            },
        ),
    )
    approved_revision = resolution.canvas_revision if resolution else None
    observations: list[Observation] = []
    for action in actions:
        if decision == "reject":
            observation = Observation(
                action.call.id,
                action.binding.name,
                False,
                "用户拒绝了该操作。",
                error_code="approval_rejected",
            )
        else:
            observation = await execute_tool_phase(
                action,
                listener=listener,
                run_id=run_id,
                round_index=round_index,
                scope=scope,
                approved_canvas_revision=approved_revision,
            )
        if observation.success and "canvas_revision" in observation.data:
            scope["canvas_revision"] = observation.data["canvas_revision"]
            approved_revision = int(observation.data["canvas_revision"])
        observations.append(observation)
    return observations
