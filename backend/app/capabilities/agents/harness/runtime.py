from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import replace
from uuid import uuid4

from app.capabilities.agents.harness.approval import ApprovalBroker, approval_broker
from app.capabilities.agents.harness.contracts import (
    AgentMessage,
    ModelAdapter,
    Usage,
)
from app.capabilities.agents.harness.phases import (
    approval_phase,
    emit_event,
    execute_tool_phase,
    model_turn_phase,
    propose_tools_phase,
)
from app.capabilities.agents.harness.types import (
    AgentDefinition,
    AgentEvent,
    EventListener,
    Observation,
    ProposedAction,
    RunResult,
    RunStatus,
    ToolBinding,
)


async def _maybe_emit(listener: EventListener | None, event: AgentEvent) -> None:
    await emit_event(listener, event)


class ReactiveToolLoop:
    def __init__(
        self,
        *,
        adapter: ModelAdapter,
        definition: AgentDefinition,
        scope: dict[str, object],
        approvals: ApprovalBroker | None = None,
        run_id: str | None = None,
    ) -> None:
        self.adapter = adapter
        self.definition = definition
        self.scope = dict(scope)
        self.approvals = approvals or approval_broker
        self.run_id = run_id or str(uuid4())
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
        return await execute_tool_phase(
            action,
            listener=listener,
            run_id=self.run_id,
            round_index=round_index,
            scope=self.scope,
            approved_canvas_revision=approved_canvas_revision,
        )

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
                current_text, turn_end = await model_turn_phase(
                    self.adapter,
                    definition,
                    messages=messages,
                    tool_specs=tool_specs,
                    listener=listener,
                    run_id=self.run_id,
                    round_index=round_index,
                    abort=self._abort,
                )
                usage = usage.merged(turn_end.usage)
                if current_text:
                    final_text += current_text

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
                proposal = await propose_tools_phase(
                    definition,
                    turn_end.tool_calls,
                    tools=tools,
                    scope=self.scope,
                    listener=listener,
                    run_id=self.run_id,
                    round_index=round_index,
                )
                for observation in proposal.unavailable:
                    observations.append(observation)
                    messages.append(
                        AgentMessage(
                            role="tool",
                            text=observation.model_text,
                            tool_call_id=observation.action_id,
                            tool_name=observation.tool_name,
                        )
                    )
                    tool_failures += 1

                actions = list(proposal.actions)
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
                    approved = await approval_phase(
                        gated,
                        approvals=self.approvals,
                        listener=listener,
                        run_id=self.run_id,
                        round_index=round_index,
                        scope=self.scope,
                        timeout_seconds=definition.budgets.approval_timeout_seconds,
                    )
                    for observation in approved:
                        observations.append(observation)
                        if (
                            not observation.success
                            and observation.error_code != "approval_rejected"
                        ):
                            tool_failures += 1
                        messages.append(
                            AgentMessage(
                                role="tool",
                                text=observation.model_text[
                                    : definition.budgets.tool_result_characters
                                ],
                                tool_call_id=observation.action_id,
                                tool_name=observation.tool_name,
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
