from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Callable
from dataclasses import replace
from uuid import uuid4

from app.agents.harness.approval import ApprovalBroker, approval_broker
from app.agents.harness.context import ContextCompiler
from app.agents.harness.contracts import (
    AgentMessage,
    ModelAdapter,
    ModelTextDelta,
    ModelTurnEnd,
    Usage,
)
from app.agents.harness.types import (
    AgentDefinition,
    AgentEvent,
    EventListener,
    Observation,
    ProposedAction,
    RunResult,
    RunStatus,
    ToolBinding,
    ToolExecutionContext,
)


async def _maybe_emit(listener: EventListener | None, event: AgentEvent) -> None:
    if listener is None:
        return
    result = listener(event)
    if inspect.isawaitable(result):
        await result


class ReactiveToolLoop:
    def __init__(
        self,
        *,
        adapter: ModelAdapter,
        definition: AgentDefinition,
        scope: dict[str, object],
        approvals: ApprovalBroker | None = None,
    ) -> None:
        self.adapter = adapter
        self.definition = definition
        self.scope = dict(scope)
        self.approvals = approvals or approval_broker
        self.run_id = str(uuid4())
        self._abort = asyncio.Event()
        self._running = False
        self._listeners: list[EventListener] = []

    def subscribe(self, listener: EventListener) -> Callable[[], None]:
        self._listeners.append(listener)

        def unsubscribe() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsubscribe

    def update_configuration(
        self,
        *,
        model: str | None = None,
        tools: tuple[ToolBinding, ...] | None = None,
    ) -> None:
        if self._running:
            raise RuntimeError("agent harness configuration is locked while running")
        changes = {}
        if model is not None:
            changes["model"] = model
        if tools is not None:
            changes["tools"] = tools
        self.definition = replace(self.definition, **changes)

    async def abort(self) -> None:
        self._abort.set()
        await self.approvals.cancel_run(self.run_id)

    async def _execute(
        self,
        action: ProposedAction,
        *,
        listener: EventListener | None,
        round_index: int,
        approved_canvas_revision: int | None,
    ) -> Observation:
        started = time.perf_counter()
        await _maybe_emit(
            listener,
            AgentEvent(
                "tool_started",
                self.run_id,
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
                observation = await action.binding.handler(
                    action.arguments,
                    ToolExecutionContext(
                        run_id=self.run_id,
                        tool_call_id=action.call.id,
                        scope=self.scope,
                        approved_canvas_revision=approved_canvas_revision,
                    ),
                )
        except TimeoutError:
            observation = Observation(
                action_id=action.call.id,
                tool_name=action.binding.name,
                success=False,
                model_text="工具执行超时。",
                error_code="tool_timeout",
                retryable=True,
            )
        except Exception as exc:  # noqa: BLE001
            observation = Observation(
                action_id=action.call.id,
                tool_name=action.binding.name,
                success=False,
                model_text=f"工具执行失败：{str(exc)[:1000]}",
                error_code="tool_failed",
                retryable=False,
            )
        elapsed = max(0, round((time.perf_counter() - started) * 1000))
        observation = Observation(
            action_id=observation.action_id,
            tool_name=observation.tool_name,
            success=observation.success,
            model_text=observation.model_text,
            data=observation.data,
            error_code=observation.error_code,
            retryable=observation.retryable,
            duration_ms=elapsed,
        )
        await _maybe_emit(
            listener,
            AgentEvent(
                "tool_completed" if observation.success else "tool_failed",
                self.run_id,
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

    async def run(
        self,
        *,
        messages: list[AgentMessage],
        user_text: str,
        listener: EventListener | None = None,
    ) -> RunResult:
        del user_text
        if self._running:
            raise RuntimeError("agent harness is already running")
        self._running = True
        provided_listener = listener

        async def dispatch(event: AgentEvent) -> None:
            await _maybe_emit(provided_listener, event)
            for subscriber in tuple(self._listeners):
                await _maybe_emit(subscriber, event)

        listener = dispatch
        definition = self.definition
        observations: list[Observation] = []
        usage = Usage()
        final_text = ""
        tool_failures = 0
        try:
            await _maybe_emit(
                listener,
                AgentEvent("run_started", self.run_id, payload={"definition_id": definition.id}),
            )
            tools = {binding.name: binding for binding in definition.tools}
            tool_specs = [binding.spec() for binding in definition.tools]

            for round_index in range(definition.budgets.max_rounds):
                if self._abort.is_set():
                    raise asyncio.CancelledError
                fragments = []
                for source in definition.context_sources:
                    fragments.extend(await source())
                context, context_summary = ContextCompiler(
                    definition.budgets.context_characters
                ).compile(fragments)
                system_prompt = definition.instructions
                if context:
                    system_prompt = f"{system_prompt}\n\n{context}"
                await _maybe_emit(
                    listener,
                    AgentEvent(
                        "context_compiled",
                        self.run_id,
                        round_index,
                        context_summary,
                    ),
                )
                await _maybe_emit(
                    listener,
                    AgentEvent("model_started", self.run_id, round_index),
                )
                round_text: list[str] = []
                turn_end: ModelTurnEnd | None = None
                try:
                    async with asyncio.timeout(definition.budgets.model_turn_timeout_seconds):
                        async for event in self.adapter.stream_turn(
                            system=system_prompt,
                            messages=messages,
                            tools=tool_specs,
                            model=definition.model,
                            temperature=definition.temperature,
                            max_tokens=definition.max_tokens,
                            round_index=round_index,
                        ):
                            if self._abort.is_set():
                                raise asyncio.CancelledError
                            if isinstance(event, ModelTextDelta):
                                round_text.append(event.text)
                                await _maybe_emit(
                                    listener,
                                    AgentEvent(
                                        "model_text_delta",
                                        self.run_id,
                                        round_index,
                                        {"text": event.text},
                                    ),
                                )
                            else:
                                turn_end = event
                except TimeoutError as exc:
                    raise RuntimeError("model_turn_timeout") from exc
                turn_end = turn_end or ModelTurnEnd()
                usage = usage.merged(turn_end.usage)
                current_text = "".join(round_text)
                if current_text:
                    final_text += current_text
                await _maybe_emit(
                    listener,
                    AgentEvent(
                        "model_completed",
                        self.run_id,
                        round_index,
                        {"tool_call_count": len(turn_end.tool_calls)},
                    ),
                )

                if not turn_end.tool_calls:
                    decision = await definition.verifier.verify(
                        final_text=current_text,
                        observations=tuple(observations),
                        round_index=round_index,
                    )
                    await _maybe_emit(
                        listener,
                        AgentEvent(
                            "verification_completed",
                            self.run_id,
                            round_index,
                            {"decision": decision.decision, "reason": decision.reason},
                        ),
                    )
                    if decision.decision == "complete":
                        result = RunResult(
                            self.run_id,
                            RunStatus.COMPLETED,
                            final_text,
                            tuple(messages),
                            tuple(observations),
                            usage,
                            decision.reason,
                        )
                        await _maybe_emit(
                            listener,
                            AgentEvent(
                                "run_completed",
                                self.run_id,
                                round_index,
                                {"status": result.status.value},
                            ),
                        )
                        return result
                    if decision.decision == "fail":
                        return RunResult(
                            self.run_id,
                            RunStatus.FAILED,
                            final_text,
                            tuple(messages),
                            tuple(observations),
                            usage,
                            decision.reason,
                        )
                    messages.append(AgentMessage(role="assistant", text=current_text))
                    messages.append(AgentMessage(role="user", text=decision.feedback))
                    continue

                messages.append(
                    AgentMessage(
                        role="assistant",
                        text=current_text,
                        tool_calls=tuple(turn_end.tool_calls),
                    )
                )
                actions: list[ProposedAction] = []
                for call in turn_end.tool_calls:
                    binding = tools.get(call.name)
                    if binding is None:
                        observation = Observation(
                            call.id,
                            call.name,
                            False,
                            "工具不存在或当前不可用。",
                            error_code="tool_unavailable",
                        )
                        observations.append(observation)
                        messages.append(
                            AgentMessage(
                                role="tool",
                                text=observation.model_text,
                                tool_call_id=call.id,
                                tool_name=call.name,
                            )
                        )
                        tool_failures += 1
                        continue
                    policy = await definition.policy.evaluate(binding, call.arguments, self.scope)
                    action = ProposedAction(
                        call=call,
                        binding=binding,
                        arguments=dict(call.arguments),
                        summary=binding.summarize(call.arguments),
                        policy=policy,
                    )
                    actions.append(action)
                    await _maybe_emit(
                        listener,
                        AgentEvent(
                            "tool_proposed",
                            self.run_id,
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

                denied = [item for item in actions if item.policy.decision == "deny"]
                allowed = [item for item in actions if item.policy.decision == "allow"]
                gated = [item for item in actions if item.policy.decision == "require_approval"]
                for action in denied:
                    observation = Observation(
                        action.call.id,
                        action.binding.name,
                        False,
                        f"操作被策略拒绝：{action.policy.reason}",
                        error_code="policy_denied",
                    )
                    observations.append(observation)
                    messages.append(
                        AgentMessage(
                            role="tool",
                            text=observation.model_text,
                            tool_call_id=action.call.id,
                            tool_name=action.binding.name,
                        )
                    )

                for action in allowed:
                    observation = await self._execute(
                        action,
                        listener=listener,
                        round_index=round_index,
                        approved_canvas_revision=None,
                    )
                    observations.append(observation)
                    if not observation.success:
                        tool_failures += 1
                    messages.append(
                        AgentMessage(
                            role="tool",
                            text=observation.model_text[
                                : definition.budgets.tool_result_characters
                            ],
                            tool_call_id=action.call.id,
                            tool_name=action.binding.name,
                        )
                    )

                if gated:
                    approval_id = str(uuid4())
                    proposal_canvas_revision = int(self.scope.get("canvas_revision") or 0)
                    await _maybe_emit(
                        listener,
                        AgentEvent(
                            "approval_requested",
                            self.run_id,
                            round_index,
                            {
                                "approval_id": approval_id,
                                "canvas_revision": proposal_canvas_revision,
                                "actions": [
                                    {
                                        "action_id": item.call.id,
                                        "tool_name": item.binding.name,
                                        "effect": item.binding.effect,
                                        "summary": item.summary,
                                    }
                                    for item in gated
                                ],
                            },
                        ),
                    )
                    try:
                        resolution = await self.approvals.wait(
                            run_id=self.run_id,
                            approval_id=approval_id,
                            scope=self.scope,
                            proposal_canvas_revision=proposal_canvas_revision,
                            timeout_seconds=definition.budgets.approval_timeout_seconds,
                        )
                    except TimeoutError:
                        resolution = None
                    decision = resolution.decision if resolution else "reject"
                    await _maybe_emit(
                        listener,
                        AgentEvent(
                            "approval_resolved",
                            self.run_id,
                            round_index,
                            {
                                "approval_id": approval_id,
                                "decision": decision,
                                "reason": "审批已超时" if resolution is None else "",
                            },
                        ),
                    )
                    approved_revision = resolution.canvas_revision if resolution else None
                    for action in gated:
                        if decision == "reject":
                            observation = Observation(
                                action.call.id,
                                action.binding.name,
                                False,
                                "用户拒绝了该操作。",
                                error_code="approval_rejected",
                            )
                        else:
                            observation = await self._execute(
                                action,
                                listener=listener,
                                round_index=round_index,
                                approved_canvas_revision=approved_revision,
                            )
                        observations.append(observation)
                        if (
                            not observation.success
                            and observation.error_code != "approval_rejected"
                        ):
                            tool_failures += 1
                        if observation.success and "canvas_revision" in observation.data:
                            self.scope["canvas_revision"] = observation.data["canvas_revision"]
                            approved_revision = int(observation.data["canvas_revision"])
                        messages.append(
                            AgentMessage(
                                role="tool",
                                text=observation.model_text[
                                    : definition.budgets.tool_result_characters
                                ],
                                tool_call_id=action.call.id,
                                tool_name=action.binding.name,
                            )
                        )

                if tool_failures >= definition.budgets.max_tool_failures:
                    return RunResult(
                        self.run_id,
                        RunStatus.FAILED,
                        final_text,
                        tuple(messages),
                        tuple(observations),
                        usage,
                        "工具失败次数超过限制",
                    )

            return RunResult(
                self.run_id,
                RunStatus.BUDGET_EXHAUSTED,
                final_text,
                tuple(messages),
                tuple(observations),
                usage,
                "模型轮次预算已耗尽",
            )
        except asyncio.CancelledError:
            await self.abort()
            await _maybe_emit(
                listener,
                AgentEvent("run_cancelled", self.run_id, payload={"status": "cancelled"}),
            )
            raise
        finally:
            self._running = False


class AgentHarness(ReactiveToolLoop):
    """Business-facing harness using the first built-in reactive strategy."""
