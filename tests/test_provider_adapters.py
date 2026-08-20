from io import BytesIO

import httpx
import pytest

from app.llm.providers._senseaudio import SenseAudioProviderError
from app.llm.providers.senseaudio_asr import (
    SenseAudioAsrFileTooLarge,
    transcribe_audio,
)
from app.llm.providers.senseaudio_image import create_image_task, get_image_task
from app.llm.providers.senseaudio_video import create_video_task, get_video_task
from app.llm.providers.streaming import ChatMessageInput, ImageInput, stream_text_completion
from app.llm.providers.text import invoke_diagnostic


@pytest.mark.asyncio
async def test_senseaudio_image_adapter_maps_async_create_and_status() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer image-secret"
        if request.method == "POST":
            assert request.url.path == "/v1/image/async"
            assert request.read().decode() == (
                '{"model":"senseaudio-image-2.0-260319","prompt":"星空",'
                '"size":"1024x1024","seed":7,"reference":'
                '"data:image/png;base64,AAAA"}'
            )
            return httpx.Response(200, json={"task_id": "image-task"})
        assert request.url.path == "/v1/image/pending"
        assert dict(request.url.params) == {"task_id": "image-task"}
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "url": "https://cdn.example/result.png",
            },
        )

    transport = httpx.MockTransport(handler)
    task_id = await create_image_task(
        base_url="https://gateway.example/v1/",
        api_key="image-secret",
        model="senseaudio-image-2.0-260319",
        prompt="星空",
        size="1024x1024",
        seed=7,
        reference="data:image/png;base64,AAAA",
        transport=transport,
    )
    status = await get_image_task(
        base_url="https://gateway.example/v1",
        api_key="image-secret",
        task_id=task_id,
        transport=transport,
    )
    assert len(requests) == 2
    assert status.status == "completed"
    assert status.progress == 100
    assert status.result_url == "https://cdn.example/result.png"


@pytest.mark.asyncio
async def test_senseaudio_video_adapter_maps_create_and_status() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer video-secret"
        if request.method == "POST":
            assert request.url.path == "/v1/video/create"
            assert request.read().decode() == (
                '{"model":"doubao-seedance-2-0-260128","content":'
                '[{"type":"text","text":"推进镜头"}],"duration":5,'
                '"resolution":"720p","ratio":"16:9","watermark":true,'
                '"provider_specific":{"generate_audio":false}}'
            )
            return httpx.Response(200, json={"task_id": "video-task"})
        assert request.url.path == "/v1/video/status"
        assert dict(request.url.params) == {"id": "video-task"}
        return httpx.Response(
            200,
            json={
                "status": "processing",
                "progress": 48,
                "video_url": "",
            },
        )

    transport = httpx.MockTransport(handler)
    task_id = await create_video_task(
        base_url="https://gateway.example/v1",
        api_key="video-secret",
        model="doubao-seedance-2-0-260128",
        content=[{"type": "text", "text": "推进镜头"}],
        duration=5,
        resolution="720p",
        ratio="16:9",
        watermark=True,
        generate_audio=False,
        transport=transport,
    )
    status = await get_video_task(
        base_url="https://gateway.example/v1",
        api_key="video-secret",
        task_id=task_id,
        transport=transport,
    )
    assert status.status == "processing"
    assert status.progress == 48


@pytest.mark.asyncio
async def test_senseaudio_asr_adapter_requests_and_normalizes_speaker_segments() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://gateway.example/v1/audio/transcriptions"
        assert request.headers["authorization"] == "Bearer asr-secret"
        body = (await request.aread()).decode()
        for value in (
            'name="model"',
            "senseaudio-asr-pro-1.5-260319",
            'name="response_format"',
            "verbose_json",
            'name="enable_speaker_diarization"',
            'name="enable_punctuation"',
            'name="timestamp_granularities[]"',
            "segment",
            'name="language"',
            "zh",
            'filename="meeting.wav"',
        ):
            assert value in body
        return httpx.Response(
            200,
            json={
                "text": "你好。欢迎。",
                "segments": [
                    {"start": 1.235, "end": 2.5, "text": "欢迎。", "speaker": "speaker_1"},
                    {"start": 0, "end": 1.2346, "text": "你好。", "speaker": "speaker_0"},
                    {"start": "bad", "end": 4, "text": "忽略", "speaker": "speaker_2"},
                ],
            },
        )

    result = await transcribe_audio(
        base_url="https://gateway.example/v1/",
        api_key="asr-secret",
        model="senseaudio-asr-pro-1.5-260319",
        filename="meeting.wav",
        source=BytesIO(b"RIFFaudio"),
        mime_type="audio/wav",
        byte_size=9,
        language="zh",
        transport=httpx.MockTransport(handler),
    )

    assert result.text == "你好。欢迎。"
    assert [(item.speaker, item.start_ms, item.end_ms, item.text) for item in result.segments] == [
        ("speaker_0", 0, 1235, "你好。"),
        ("speaker_1", 1235, 2500, "欢迎。"),
    ]


@pytest.mark.asyncio
async def test_senseaudio_asr_adapter_omits_auto_language_and_accepts_no_segments() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = (await request.aread()).decode()
        assert 'name="language"' not in body
        return httpx.Response(200, json={"text": "只有整段文本。"})

    result = await transcribe_audio(
        base_url="https://gateway.example/v1",
        api_key="asr-secret",
        model="senseaudio-asr-pro-1.5-260319",
        filename="meeting.wav",
        source=BytesIO(b"RIFFaudio"),
        mime_type="audio/wav",
        byte_size=9,
        language="auto",
        transport=httpx.MockTransport(handler),
    )

    assert result.text == "只有整段文本。"
    assert result.segments == ()


@pytest.mark.asyncio
async def test_senseaudio_asr_adapter_rejects_oversized_files_before_request() -> None:
    async def unexpected(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("oversized files must not reach the provider")

    with pytest.raises(SenseAudioAsrFileTooLarge, match="10 MB"):
        await transcribe_audio(
            base_url="https://gateway.example/v1",
            api_key="asr-secret",
            model="senseaudio-asr-pro-1.5-260319",
            filename="large.wav",
            source=BytesIO(b"audio"),
            mime_type="audio/wav",
            byte_size=10 * 1024 * 1024 + 1,
            transport=httpx.MockTransport(unexpected),
        )


@pytest.mark.asyncio
async def test_senseaudio_asr_adapter_maps_provider_errors() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "invalid audio"})

    with pytest.raises(SenseAudioProviderError, match="invalid audio"):
        await transcribe_audio(
            base_url="https://gateway.example/v1",
            api_key="asr-secret",
            model="senseaudio-asr-pro-1.5-260319",
            filename="broken.wav",
            source=BytesIO(b"broken"),
            mime_type="audio/wav",
            byte_size=6,
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_senseaudio_adapter_redacts_sensitive_error_details() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "message": (
                    "Authorization: Bearer leaked-secret reference=data:image/png;base64,AAAA"
                )
            },
        )

    with pytest.raises(SenseAudioProviderError) as error:
        await create_image_task(
            base_url="https://gateway.example/v1",
            api_key="real-secret",
            model="senseaudio-image-2.0-260319",
            prompt="test",
            size="1024x1024",
            transport=httpx.MockTransport(handler),
        )
    message = str(error.value)
    assert "leaked-secret" not in message
    assert "AAAA" not in message
    assert "[REDACTED]" in message


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
                'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
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
            messages=[ChatMessageInput(role="user", text="hello")],
            temperature=0.7,
            max_tokens=100,
            transport=httpx.MockTransport(handler),
        )
    ]
    assert "".join(chunk.text for chunk in chunks) == "AB"
    assert chunks[-1].total_tokens == 5
    assert any(chunk.finish_reason == "stop" for chunk in chunks)


@pytest.mark.asyncio
async def test_anthropic_streaming_normalizes_deltas_and_usage() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=(
                'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n'
                'data: {"type":"content_block_delta","delta":{"type":"text_delta",'
                '"text":"Hi"}}\n\n'
                'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},'
                '"usage":{"output_tokens":2}}\n\n'
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
            messages=[ChatMessageInput(role="user", text="hello")],
            temperature=0.2,
            max_tokens=50,
            transport=httpx.MockTransport(handler),
        )
    ]
    assert "".join(chunk.text for chunk in chunks) == "Hi"
    assert chunks[-1].prompt_tokens == 4
    assert chunks[-1].completion_tokens == 2
    assert chunks[-1].total_tokens == 6
    assert chunks[-1].finish_reason == "end_turn"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["openai", "anthropic"])
async def test_streaming_maps_image_inputs_without_losing_order(kind: str) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = request.read().decode()
        assert body.index("base64-image-one") < body.index("base64-image-two")
        assert body.index("base64-image-two") < body.index("describe both")
        if kind == "openai":
            assert '"type":"image_url"' in body
            assert '"url":"data:image/png;base64,base64-image-one"' in body
            response = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
        else:
            assert '"type":"image"' in body
            assert '"media_type":"image/png"' in body
            assert '"data":"base64-image-one"' in body
            response = (
                'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
            )
        return httpx.Response(200, text=response, headers={"content-type": "text/event-stream"})

    chunks = [
        chunk
        async for chunk in stream_text_completion(
            kind=kind,
            base_url="https://gateway.example/v1",
            api_key="secret",
            model="vision-model",
            system_prompt="",
            messages=[
                ChatMessageInput(
                    role="user",
                    text="describe both",
                    images=(
                        ImageInput("image/png", "base64-image-one", 10),
                        ImageInput("image/webp", "base64-image-two", 20),
                    ),
                )
            ],
            temperature=0.2,
            max_tokens=50,
            transport=httpx.MockTransport(handler),
        )
    ]
    assert "".join(chunk.text for chunk in chunks) == "ok"
