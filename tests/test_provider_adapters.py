import httpx
import pytest

from app.llm.providers.streaming import stream_text_completion
from app.llm.providers.text import invoke_diagnostic


@pytest.mark.asyncio
async def test_openai_compatible_diagnostic_normalizes_usage() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer secret"
        assert b"secret" not in request.content
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "OK"}}],
                "usage": {"prompt_tokens": 6, "completion_tokens": 1, "total_tokens": 7},
            },
        )

    result = await invoke_diagnostic(
        kind="openai",
        base_url="https://gateway.example/v1",
        api_key="secret",
        model="example-model",
        transport=httpx.MockTransport(handler),
    )
    assert result.output == "OK"
    assert result.total_tokens == 7


@pytest.mark.asyncio
async def test_anthropic_diagnostic_normalizes_content_and_usage() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/messages"
        assert request.headers["x-api-key"] == "secret"
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "OK"}],
                "usage": {"input_tokens": 5, "output_tokens": 1},
            },
        )

    result = await invoke_diagnostic(
        kind="anthropic",
        base_url="https://api.anthropic.com/v1",
        api_key="secret",
        model="claude-example",
        transport=httpx.MockTransport(handler),
    )
    assert result.output == "OK"
    assert result.prompt_tokens == 5
    assert result.completion_tokens == 1
    assert result.total_tokens == 6


@pytest.mark.asyncio
async def test_openai_streaming_normalizes_deltas_and_usage() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        body = request.read().decode()
        assert '"stream":true' in body
        return httpx.Response(
            200,
            text=(
                'data: {"choices":[{"delta":{"content":"A"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":"B"}}]}\n\n'
                'data: {"choices":[],"usage":{"prompt_tokens":3,'
                '"completion_tokens":2,"total_tokens":5}}\n\n'
                "data: [DONE]\n\n"
            ),
            headers={"content-type": "text/event-stream"},
        )

    chunks = [
        chunk
        async for chunk in stream_text_completion(
            kind="openai",
            base_url="https://gateway.example/v1",
            api_key="secret",
            model="model",
            system_prompt="system",
            messages=[{"role": "user", "content": "hello"}],
            temperature=0.7,
            max_tokens=100,
            transport=httpx.MockTransport(handler),
        )
    ]
    assert "".join(chunk.text for chunk in chunks) == "AB"
    assert chunks[-1].total_tokens == 5


@pytest.mark.asyncio
async def test_anthropic_streaming_normalizes_deltas_and_usage() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=(
                'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n'
                'data: {"type":"content_block_delta","delta":{"type":"text_delta",'
                '"text":"Hi"}}\n\n'
                'data: {"type":"message_delta","usage":{"output_tokens":2}}\n\n'
            ),
            headers={"content-type": "text/event-stream"},
        )

    chunks = [
        chunk
        async for chunk in stream_text_completion(
            kind="anthropic",
            base_url="https://api.anthropic.com/v1",
            api_key="secret",
            model="claude",
            system_prompt="",
            messages=[{"role": "user", "content": "hello"}],
            temperature=0.2,
            max_tokens=50,
            transport=httpx.MockTransport(handler),
        )
    ]
    assert "".join(chunk.text for chunk in chunks) == "Hi"
    assert chunks[-1].prompt_tokens == 4
    assert chunks[-1].completion_tokens == 2
    assert chunks[-1].total_tokens == 6
