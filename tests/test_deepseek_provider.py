"""DeepSeek transport behavior, including tool follow-ups and failure semantics."""

import asyncio
import io
import json
import zipfile
from datetime import datetime

import httpx
import pytest

from app.capabilities.agents.harness.contracts import ModelUsageUpdate
from app.llm.call_logs.reproduction import build_reproduction_bundle
from app.llm.models import LlmCallLog
from app.llm.providers.agent import AgentMessage, HttpAgentAdapter, ModelTurnEnd, ToolCall, ToolSpec
from app.llm.providers.streaming import (
    ChatMessageInput,
    ImageInput,
    ProviderStreamError,
    stream_text_completion,
)
from app.llm.providers.text import invoke_diagnostic


def frame(payload):
    return "data: " + json.dumps(payload) + "\n\n"


@pytest.mark.asyncio
@pytest.mark.parametrize("base_url", ["", "https://proxy.example/v1/"])
async def test_diagnostic_uses_official_defaults_or_custom_address(base_url):
    def handler(request):
        assert str(request.url) == (
            (base_url.rstrip("/") or "https://api.deepseek.com") + "/chat/completions"
        )
        assert request.headers["authorization"] == "Bearer test-secret"
        body = json.loads(request.content)
        assert body["thinking"] == {"type": "disabled"}
        assert body["model"] == "deepseek-flash"
        assert body["max_tokens"] == 16
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "OK"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4},
            },
        )

    result = await invoke_diagnostic(
        kind="deepseek",
        base_url=base_url,
        api_key="test-secret",
        model="deepseek-flash",
        transport=httpx.MockTransport(handler),
    )
    assert result.output == "OK"
    assert result.total_tokens == 4


@pytest.mark.asyncio
async def test_stream_maps_images_text_usage_and_ignores_reasoning():
    def handler(request):
        body = json.loads(request.content)
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer test-secret"
        assert body["thinking"] == {"type": "disabled"}
        assert body["messages"][0] == {"role": "system", "content": "system"}
        assert (
            body["messages"][1]["content"][0]["image_url"]["url"]
            == "data:image/png;base64,aW1hZ2U="
        )
        return httpx.Response(
            200,
            text=": keepalive\n\n"
            + frame({"choices": [{"delta": {"reasoning_content": "hidden"}}]})
            + frame({"choices": [{"delta": {"content": "答案"}}]})
            + frame({"choices": [{"finish_reason": "stop", "delta": {}}]})
            + frame(
                {
                    "choices": [],
                    "usage": {"prompt_tokens": 8, "completion_tokens": 2, "total_tokens": 10},
                }
            )
            + "data: [DONE]\n\n",
        )

    chunks = [
        chunk
        async for chunk in stream_text_completion(
            kind="deepseek",
            base_url="",
            api_key="test-secret",
            model="deepseek-flash",
            system_prompt="system",
            messages=[ChatMessageInput("user", "看图", (ImageInput("image/png", "aW1hZ2U=", 5),))],
            temperature=0.4,
            max_tokens=100,
            transport=httpx.MockTransport(handler),
        )
    ]
    assert "".join(chunk.text for chunk in chunks) == "答案"
    assert chunks[-1].total_tokens == 10
    assert any(chunk.finish_reason == "stop" for chunk in chunks)


@pytest.mark.asyncio
async def test_tools_round_trip_without_thinking_on_every_turn():
    requests = []

    def handler(request):
        assert str(request.url) == "https://custom.example/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-secret"
        body = json.loads(request.content)
        requests.append(body)
        assert body["thinking"] == {"type": "disabled"}
        assert body["tools"][0]["function"]["name"] == "read_canvas"
        if len(requests) == 1:
            data = frame(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call-1",
                                        "function": {
                                            "name": "read_canvas",
                                            "arguments": '{"revision":',
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            )
            data += frame(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [{"index": 0, "function": {"arguments": "3}"}}]
                            },
                            "finish_reason": "tool_calls",
                        }
                    ]
                }
            )
        else:
            assert body["messages"][-1] == {
                "role": "tool",
                "tool_call_id": "call-1",
                "content": "canvas",
            }
            assert (
                body["messages"][-2]["tool_calls"][0]["function"]["arguments"] == '{"revision": 3}'
            )
            data = frame({"choices": [{"delta": {"content": "完成"}, "finish_reason": "stop"}]})
        return httpx.Response(200, text=data + "data: [DONE]\n\n")

    adapter = HttpAgentAdapter(
        kind="deepseek",
        base_url="https://custom.example/v1",
        api_key="test-secret",
        transport=httpx.MockTransport(handler),
    )
    messages = [AgentMessage("user", "读取")]
    args = dict(
        system="system",
        tools=[ToolSpec("read_canvas", "读取画布", {"type": "object"})],
        model="deepseek-flash",
        temperature=0.2,
        max_tokens=100,
    )
    first = [event async for event in adapter.stream_turn(messages=messages, round_index=0, **args)]
    assert isinstance(first[-1], ModelTurnEnd)
    assert first[-1].tool_calls == (ToolCall("call-1", "read_canvas", {"revision": 3}),)
    messages.extend(
        [
            AgentMessage("assistant", tool_calls=first[-1].tool_calls),
            AgentMessage("tool", "canvas", tool_call_id="call-1"),
        ]
    )
    second = [
        event async for event in adapter.stream_turn(messages=messages, round_index=1, **args)
    ]
    assert second[0].text == "完成"
    assert len(requests) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ending", ["", frame({"error": {"message": "private-secret"}}), "event: error\ndata: {}\n\n"]
)
async def test_agent_error_keeps_partial_events_and_usage_without_success(ending):
    data = frame({"choices": [{"delta": {"content": "partial"}}]})
    data += frame({"usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6}})
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, text=data + ending)

    adapter = HttpAgentAdapter(
        kind="deepseek", base_url="", api_key="test-secret", transport=httpx.MockTransport(handler)
    )
    events = []
    with pytest.raises(ProviderStreamError) as error:
        async for event in adapter.stream_turn(
            system="",
            messages=[AgentMessage("user", "hello")],
            tools=[],
            model="deepseek-flash",
            temperature=0.2,
            max_tokens=100,
            round_index=0,
        ):
            events.append(event)
    assert events[0].text == "partial"
    assert isinstance(events[1], ModelUsageUpdate)
    assert events[1].usage.total_tokens == 6
    assert not any(isinstance(event, ModelTurnEnd) for event in events)
    assert "private-secret" not in str(error.value)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_cancelled_transport_is_not_retried():
    calls = []

    def handler(request):
        calls.append(request)
        raise asyncio.CancelledError

    adapter = HttpAgentAdapter(
        kind="deepseek", base_url="", api_key="test-secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(asyncio.CancelledError):
        async for _ in adapter.stream_turn(
            system="",
            messages=[],
            tools=[],
            model="deepseek-flash",
            temperature=0.2,
            max_tokens=100,
            round_index=0,
        ):
            pass
    assert len(calls) == 1


def test_reproduction_uses_same_protocol_thinking_mode_and_default_address():
    row = LlmCallLog(
        id="log",
        provider_kind="deepseek",
        model="deepseek-flash",
        trace_id="trace",
        call_source="model_playground",
        status="success",
        created_at=datetime(2026, 10, 23),
        latency_ms=1,
        request_payload={
            "messages": [{"role": "user", "content": "hello"}],
            "tools": [{"name": "read_canvas", "input_schema": {"type": "object"}}],
        },
        response_payload={},
    )
    bundle = build_reproduction_bundle(row, base_url="")
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        request = json.loads(archive.read("request.json"))
    assert request["base_url"] == "https://api.deepseek.com"
    assert request["endpoint"] == "/chat/completions"
    assert request["body"]["thinking"] == {"type": "disabled"}
    assert request["body"]["tools"][0]["function"]["name"] == "read_canvas"
