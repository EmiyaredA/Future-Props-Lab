import json

import httpx
import pytest

from app.llm.providers.streaming import (
    ChatMessageInput,
    ProviderStreamError,
    stream_text_completion,
)


def run_stream(kind, data):
    return stream_text_completion(
        kind=kind,
        base_url="https://gateway.example/v1",
        api_key="secret",
        model="test",
        system_prompt="",
        messages=[ChatMessageInput(role="user", text="hello")],
        temperature=0.2,
        max_tokens=100,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=data)),
    )


def frame(payload):
    return "data: " + json.dumps(payload) + "\n\n"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["openai", "anthropic"])
@pytest.mark.parametrize("partial", [False, True])
async def test_stream_error_does_not_complete_or_expose_provider_detail(kind, partial):
    delta = (
        {"choices": [{"delta": {"content": "partial"}}]}
        if kind == "openai"
        else {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "partial"}}
    )
    error = {"error": {"message": "secret token private URL"}}
    if kind == "anthropic":
        error["type"] = "error"
    chunks = []
    with pytest.raises(ProviderStreamError) as captured:
        async for chunk in run_stream(kind, (frame(delta) if partial else "") + frame(error)):
            chunks.append(chunk)
    assert "secret" not in str(captured.value)
    assert "".join(chunk.text for chunk in chunks) == ("partial" if partial else "")


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["openai", "anthropic"])
async def test_premature_eof_is_failure(kind):
    with pytest.raises(ProviderStreamError, match="中断"):
        async for _ in run_stream(kind, frame({"type": "ping"})):
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["openai", "anthropic"])
async def test_named_error_and_invalid_json_are_sanitized(kind):
    for data in ['event: error\ndata: {"message":"private"}\n\n', "data: private\n\n"]:
        with pytest.raises(ProviderStreamError) as captured:
            async for _ in run_stream(kind, data):
                pass
        assert "private" not in str(captured.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ending", ["data: [DONE]\n\n", frame({"choices": [{"finish_reason": "stop"}]})]
)
async def test_openai_compatible_terminal_forms(ending):
    chunks = [chunk async for chunk in run_stream("openai", ": heartbeat\n\n" + ending)]
    assert all(not chunk.text for chunk in chunks)
