from __future__ import annotations

import json

import httpx
import pytest

from app.llm.providers.agent import (
    AgentMessage,
    HttpAgentAdapter,
    ModelTextDelta,
    ModelTurnEnd,
    ToolCall,
    ToolSpec,
)
from app.llm.providers.streaming import ImageInput


@pytest.mark.asyncio
async def test_openai_agent_adapter_assembles_streamed_tool_arguments_and_usage() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        lines = [
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call-",
                                    "function": {
                                        "name": "read_",
                                        "arguments": '{"canvas_',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "1",
                                    "function": {
                                        "name": "canvas",
                                        "arguments": 'revision":3}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 11,
                    "completion_tokens": 4,
                    "total_tokens": 15,
                },
            },
        ]
        return httpx.Response(
            200,
            text="".join(f"data: {json.dumps(item)}\n\n" for item in lines) + "data: [DONE]\n\n",
        )

    adapter = HttpAgentAdapter(
        kind="openai",
        base_url="https://models.example/v1",
        api_key="secret",
        transport=httpx.MockTransport(handler),
    )
    events = [
        event
        async for event in adapter.stream_turn(
            system="system",
            messages=[
                AgentMessage(
                    role="user",
                    text="查看画布",
                    images=(ImageInput("image/png", "aW1hZ2U=", 5),),
                )
            ],
            tools=[
                ToolSpec(
                    "read_canvas",
                    "读取画布",
                    {"type": "object", "properties": {}},
                )
            ],
            model="tool-model",
            temperature=0.2,
            max_tokens=100,
            round_index=0,
        )
    ]

    end = events[-1]
    assert isinstance(end, ModelTurnEnd)
    assert end.tool_calls == (ToolCall("call-1", "read_canvas", {"canvas_revision": 3}),)
    assert end.usage.total_tokens == 15
    assert captured["tools"][0]["function"]["name"] == "read_canvas"
    assert captured["messages"][1]["content"][0]["type"] == "image_url"
    assert "aW1hZ2U=" not in json.dumps(captured["tools"])


@pytest.mark.asyncio
async def test_anthropic_agent_adapter_round_trips_tool_results() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        lines = [
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "inspect_generation_task",
                    "input": {},
                },
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": '{"task_id":"task-1"}',
                },
            },
            {
                "type": "content_block_delta",
                "index": 1,
                "delta": {"type": "text_delta", "text": "检查中"},
            },
            {
                "type": "message_start",
                "message": {"usage": {"input_tokens": 9}},
            },
            {"type": "message_delta", "usage": {"output_tokens": 3}},
        ]
        return httpx.Response(
            200,
            text="".join(f"data: {json.dumps(item)}\n\n" for item in lines),
        )

    adapter = HttpAgentAdapter(
        kind="anthropic",
        base_url="https://models.example/v1",
        api_key="secret",
        transport=httpx.MockTransport(handler),
    )
    events = [
        event
        async for event in adapter.stream_turn(
            system="system",
            messages=[
                AgentMessage(role="user", text="检查任务"),
                AgentMessage(
                    role="assistant",
                    tool_calls=(ToolCall("previous-tool", "read_canvas", {}),),
                ),
                AgentMessage(
                    role="tool",
                    text="revision=2",
                    tool_call_id="previous-tool",
                    tool_name="read_canvas",
                ),
            ],
            tools=[],
            model="claude-test",
            temperature=0.2,
            max_tokens=100,
            round_index=1,
        )
    ]

    assert isinstance(events[0], ModelTextDelta)
    assert events[0].text == "检查中"
    end = events[-1]
    assert isinstance(end, ModelTurnEnd)
    assert end.tool_calls == (ToolCall("tool-1", "inspect_generation_task", {"task_id": "task-1"}),)
    assert end.usage.total_tokens == 12
    assert captured["messages"][-1]["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "previous-tool",
        "content": "revision=2",
    }
