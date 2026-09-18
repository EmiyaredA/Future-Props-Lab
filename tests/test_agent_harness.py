from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from app.capabilities.agents.harness import (
    AgentDefinition,
    AgentEvent,
    AgentHarness,
    ApprovalBroker,
    ContextCompiler,
    ContextFragment,
    Observation,
    RunBudgets,
    RunStatus,
    ToolBinding,
)
from app.llm.providers.agent import (
    AgentMessage,
    ModelEvent,
    ModelTextDelta,
    ModelTurnEnd,
    ToolCall,
    Usage,
)


class ScriptedAdapter:
    def __init__(self, turns: list[list[ModelEvent]]) -> None:
        self.turns = turns
        self.requests: list[dict] = []

    async def stream_turn(self, **kwargs) -> AsyncIterator[ModelEvent]:
        self.requests.append(kwargs)
        for event in self.turns[len(self.requests) - 1]:
            yield event


def binding(name: str, effect: str, handler) -> ToolBinding:
    return ToolBinding(
        name=name,
        description=name,
        input_schema={"type": "object", "properties": {}},
        effect=effect,
        handler=handler,
        summarize=lambda arguments: {"arguments": arguments},
    )


@pytest.mark.asyncio
async def test_harness_completes_a_plain_streamed_reply() -> None:
    adapter = ScriptedAdapter(
        [[ModelTextDelta("分析"), ModelTextDelta("完成"), ModelTurnEnd(usage=Usage(4, 2, 6))]]
    )
    events: list[AgentEvent] = []
    harness = AgentHarness(
        adapter=adapter,
        definition=AgentDefinition(id="plain", model="test", instructions="回答问题"),
        scope={},
    )
    subscribed: list[AgentEvent] = []
    unsubscribe = harness.subscribe(subscribed.append)
    harness.update_configuration(model="updated-test")

    result = await harness.run(
        messages=[AgentMessage(role="user", text="请分析")],
        user_text="请分析",
        listener=events.append,
    )

    assert result.status == RunStatus.COMPLETED
    assert result.final_text == "分析完成"
    assert result.usage.total_tokens == 6
    assert adapter.requests[0]["model"] == "updated-test"
    assert subscribed[-1].type == "run_completed"
    unsubscribe()
    assert [item.type for item in events if item.type == "model_text_delta"] == [
        "model_text_delta",
        "model_text_delta",
    ]


@pytest.mark.asyncio
async def test_harness_runs_a_read_tool_and_returns_the_observation_to_the_model() -> None:
    async def read_tool(_arguments, context):
        return Observation(context.tool_call_id, "read_canvas", True, "画布 revision=3")

    adapter = ScriptedAdapter(
        [
            [ModelTurnEnd((ToolCall("call-1", "read_canvas", {}),))],
            [ModelTextDelta("画布已读取"), ModelTurnEnd()],
        ]
    )
    harness = AgentHarness(
        adapter=adapter,
        definition=AgentDefinition(
            id="tools",
            model="test",
            instructions="先读取再回答",
            tools=(binding("read_canvas", "read", read_tool),),
        ),
        scope={"canvas_revision": 3},
    )

    result = await harness.run(
        messages=[AgentMessage(role="user", text="画布有什么")],
        user_text="画布有什么",
    )

    assert result.status == RunStatus.COMPLETED
    assert result.observations[0].success is True
    assert adapter.requests[1]["messages"][-1] == AgentMessage(
        role="tool",
        text="画布 revision=3",
        tool_call_id="call-1",
        tool_name="read_canvas",
    )


@pytest.mark.asyncio
async def test_approval_uses_the_proposal_revision_instead_of_rebasing() -> None:
    approved_revisions: list[int | None] = []

    async def write_tool(_arguments, context):
        approved_revisions.append(context.approved_canvas_revision)
        return Observation(
            context.tool_call_id,
            "apply_canvas_changes",
            True,
            "画布已更新",
            {"canvas_revision": 8},
        )

    broker = ApprovalBroker()
    adapter = ScriptedAdapter(
        [
            [ModelTurnEnd((ToolCall("write-1", "apply_canvas_changes", {"operations": []}),))],
            [ModelTextDelta("修改完成"), ModelTurnEnd()],
        ]
    )
    harness = AgentHarness(
        adapter=adapter,
        approvals=broker,
        definition=AgentDefinition(
            id="approval",
            model="test",
            instructions="执行修改",
            tools=(binding("apply_canvas_changes", "write", write_tool),),
            budgets=RunBudgets(approval_timeout_seconds=1),
        ),
        scope={"project_id": "p1", "conversation_id": "c1", "canvas_revision": 7},
    )

    async def listener(event: AgentEvent) -> None:
        if event.type != "approval_requested":
            return

        async def approve() -> None:
            await asyncio.sleep(0)
            await broker.resolve(
                run_id=event.run_id,
                approval_id=str(event.payload["approval_id"]),
                scope={"project_id": "p1", "conversation_id": "c1"},
                decision="approve",
                canvas_revision=99,
            )

        asyncio.create_task(approve())

    result = await harness.run(
        messages=[AgentMessage(role="user", text="更新画布")],
        user_text="更新画布",
        listener=listener,
    )

    assert result.status == RunStatus.COMPLETED
    assert approved_revisions == [7]
    assert harness.scope["canvas_revision"] == 8


@pytest.mark.asyncio
async def test_rejected_approval_is_returned_to_the_model_without_running_the_tool() -> None:
    called = False

    async def write_tool(_arguments, context):
        nonlocal called
        called = True
        return Observation(context.tool_call_id, "write", True, "不应执行")

    broker = ApprovalBroker()
    adapter = ScriptedAdapter(
        [
            [ModelTurnEnd((ToolCall("write-1", "write", {}),))],
            [ModelTextDelta("已保留原画布"), ModelTurnEnd()],
        ]
    )
    harness = AgentHarness(
        adapter=adapter,
        approvals=broker,
        definition=AgentDefinition(
            id="reject",
            model="test",
            instructions="执行修改",
            tools=(binding("write", "write", write_tool),),
            budgets=RunBudgets(approval_timeout_seconds=1),
        ),
        scope={"canvas_revision": 1},
    )

    async def listener(event: AgentEvent) -> None:
        if event.type == "approval_requested":

            async def reject() -> None:
                await asyncio.sleep(0)
                await broker.resolve(
                    run_id=event.run_id,
                    approval_id=str(event.payload["approval_id"]),
                    scope={},
                    decision="reject",
                    canvas_revision=1,
                )

            asyncio.create_task(reject())

    result = await harness.run(
        messages=[AgentMessage(role="user", text="修改")],
        user_text="修改",
        listener=listener,
    )

    assert called is False
    assert result.observations[0].error_code == "approval_rejected"
    assert result.final_text == "已保留原画布"


def test_context_compiler_preserves_a_truncation_notice() -> None:
    text, summary = ContextCompiler(30).compile(
        [
            ContextFragment("important", "a" * 20, priority=10),
            ContextFragment("secondary", "b" * 20, priority=1),
        ]
    )

    assert "important" in text
    assert "[context_truncated" in text
    assert summary["omitted"] == 1


@pytest.mark.asyncio
async def test_harness_recompiles_context_for_each_model_round() -> None:
    calls = 0

    async def context_source():
        nonlocal calls
        calls += 1
        return [ContextFragment("live", f"revision={calls}")]

    async def read_tool(_arguments, context):
        return Observation(context.tool_call_id, "read", True, "read complete")

    adapter = ScriptedAdapter(
        [
            [ModelTurnEnd((ToolCall("read-1", "read", {}),))],
            [ModelTextDelta("完成"), ModelTurnEnd()],
        ]
    )
    harness = AgentHarness(
        adapter=adapter,
        definition=AgentDefinition(
            id="live-context",
            model="test",
            instructions="use live context",
            context_sources=(context_source,),
            tools=(binding("read", "read", read_tool),),
        ),
        scope={},
    )

    result = await harness.run(
        messages=[AgentMessage(role="user", text="read")],
        user_text="read",
    )

    assert result.status == RunStatus.COMPLETED
    assert calls == 2
    assert "revision=1" in adapter.requests[0]["system"]
    assert "revision=2" in adapter.requests[1]["system"]
