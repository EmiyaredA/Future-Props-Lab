from __future__ import annotations

import asyncio
import base64
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.core.db import SessionLocal
from app.llm.providers.realtime.constants import (
    SENSEAUDIO_DEFAULT_VOICE,
    SENSEAUDIO_PCM_FRAME_BYTES,
    SENSEAUDIO_PCM_FRAME_SECONDS,
)
from app.llm.providers.realtime.contracts import ResolvedRealtimeModel
from app.llm.providers.realtime.senseaudio import SenseAudioRealtimeBridge
from app.llm.realtime.session import TurnMetrics, _write_log
from app.main import app
from app.models import LlmCallLog


def _model() -> ResolvedRealtimeModel:
    return ResolvedRealtimeModel(
        id="model-realtime",
        provider_id="provider-realtime",
        provider_name="SenseAudio Realtime",
        provider_kind="senseaudio_realtime",
        slug="senseaudio-realtime-1.0",
        label="SenseAudio Realtime 1.0",
        base_url="wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog",
        api_key="secret-key",
    )


@pytest.mark.asyncio
async def test_senseaudio_start_command_and_authorization_header() -> None:
    class Connection:
        def __init__(self) -> None:
            self.sent: list[str | bytes] = []
            self.returned_ready = False

        async def send(self, value: str | bytes) -> None:
            self.sent.append(value)

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.returned_ready:
                self.returned_ready = True
                return json.dumps({"type": "ready", "session_id": "upstream-session"})
            await asyncio.Future()

        async def close(self, **_kwargs) -> None:
            return None

    connection = Connection()
    connector_call: dict[str, object] = {}

    async def connector(endpoint: str, **kwargs):
        connector_call.update(endpoint=endpoint, **kwargs)
        return connection

    bridge = SenseAudioRealtimeBridge(
        model=_model(),
        instructions="保持简洁",
        voice=SENSEAUDIO_DEFAULT_VOICE,
        connector=connector,
    )
    await bridge.start()
    try:
        assert connector_call["endpoint"] == _model().base_url
        assert connector_call["additional_headers"] == {"Authorization": "Bearer secret-key"}
        start = json.loads(str(connection.sent[0]))
        assert start == {
            "type": "start",
            "model": "senseaudio-realtime-1.0",
            "instructions": "保持简洁",
            "greeting": "",
            "audio_setting": {
                "sample_rate": 16_000,
                "format": "pcm_s16le",
                "channel": 1,
            },
            "tools": [],
            "voice": SENSEAUDIO_DEFAULT_VOICE,
        }
        assert bridge.session_id == "upstream-session"
    finally:
        await bridge.close()


@pytest.mark.asyncio
async def test_pcm_framing_commit_and_silence_safe_watermark() -> None:
    class Connection:
        def __init__(self) -> None:
            self.sent: list[str | bytes] = []

        async def send(self, value: str | bytes) -> None:
            self.sent.append(value)

    bridge = SenseAudioRealtimeBridge(
        model=_model(), instructions="", voice=SENSEAUDIO_DEFAULT_VOICE
    )
    bridge._connection = Connection()
    bridge._handle_event({"type": "speech.started"})
    started = bridge.outbound.get_nowait()
    turn_id = started["turn_id"]
    raw = b"a" * (SENSEAUDIO_PCM_FRAME_BYTES * 2 + 64)
    bridge.append_audio(base64.b64encode(raw).decode("ascii"))
    assert bridge._audio_queue.qsize() == 2
    assert bridge.commit_input(turn_id) is True
    assert bridge._audio_queue.qsize() == 3
    assert bridge.commit_input(turn_id) is False

    while not bridge._audio_queue.empty():
        watermark, frame = bridge._audio_queue.get_nowait()
        assert len(frame) == SENSEAUDIO_PCM_FRAME_BYTES
        bridge._sent_watermark = watermark
    await bridge._maybe_send_commit()
    assert json.loads(str(bridge._connection.sent[-1])) == {"type": "commit"}
    assert bridge.outbound.get_nowait() == {
        "type": "user_speech_stopped",
        "turn_id": turn_id,
    }


@pytest.mark.asyncio
async def test_send_loop_keeps_realtime_pacing_and_fills_silence() -> None:
    bridge = SenseAudioRealtimeBridge(
        model=_model(), instructions="", voice=SENSEAUDIO_DEFAULT_VOICE
    )

    class Connection:
        def __init__(self) -> None:
            self.frames: list[bytes] = []
            self.sent_at: list[float] = []

        async def send(self, value: str | bytes) -> None:
            if isinstance(value, bytes):
                self.frames.append(value)
                self.sent_at.append(asyncio.get_running_loop().time())
                if len(self.frames) == 3:
                    bridge._closed.set()

    connection = Connection()
    bridge._connection = connection
    real_frame = b"r" * SENSEAUDIO_PCM_FRAME_BYTES
    bridge._audio_queue.put_nowait((1, real_frame))
    await asyncio.wait_for(bridge._send_loop(), timeout=1)

    assert connection.frames[0] == real_frame
    assert connection.frames[1:] == [
        b"\0" * SENSEAUDIO_PCM_FRAME_BYTES,
        b"\0" * SENSEAUDIO_PCM_FRAME_BYTES,
    ]
    assert connection.sent_at[-1] - connection.sent_at[0] >= (SENSEAUDIO_PCM_FRAME_SECONDS * 1.5)


@pytest.mark.asyncio
async def test_audio_queue_overflow_returns_retryable_error() -> None:
    bridge = SenseAudioRealtimeBridge(
        model=_model(), instructions="", voice=SENSEAUDIO_DEFAULT_VOICE
    )
    bridge._audio_queue = asyncio.Queue(maxsize=1)
    bridge.append_audio(base64.b64encode(b"x" * (SENSEAUDIO_PCM_FRAME_BYTES * 2)).decode("ascii"))
    event = bridge.outbound.get_nowait()
    assert event == {
        "type": "error",
        "code": "voice_uplink_overloaded",
        "message": "实时语音上行速度异常，请重新通话。",
        "retryable": True,
    }
    await asyncio.sleep(0)


def test_normalized_events_and_interrupt_fence_drop_late_output() -> None:
    bridge = SenseAudioRealtimeBridge(
        model=_model(), instructions="", voice=SENSEAUDIO_DEFAULT_VOICE
    )
    bridge._handle_event({"type": "speech.started"})
    first_turn = bridge.outbound.get_nowait()["turn_id"]
    bridge._handle_event({"type": "user.transcript.done", "text": "第一个问题"})
    bridge._handle_event({"type": "assistant.text.delta", "text": "旧回答"})
    assert bridge.interrupt(first_turn) == first_turn
    bridge._handle_event({"type": "assistant.text.done", "text": "迟到旧回答"})
    bridge._handle_event({"type": "turn.done"})
    bridge._handle_event({"type": "speech.started"})
    second_turn = [
        event for event in list(bridge.outbound._queue) if event["type"] == "user_speech_started"
    ][-1]["turn_id"]
    bridge._handle_event({"type": "user.transcript.done", "text": "新问题"})
    bridge._handle_event({"type": "assistant.text.delta", "text": "新回答"})
    bridge._handle_event({"type": "turn.done", "usage": {"total_tokens": 2}})
    events = list(bridge.outbound._queue)

    assert second_turn != first_turn
    assert not any(event.get("text") == "迟到旧回答" for event in events)
    assert not any(
        event["type"] == "turn_done" and event.get("turn_id") == first_turn for event in events
    )
    assert any(event.get("text") == "新回答" for event in events)
    assert any(
        event["type"] == "turn_done" and event.get("turn_id") == second_turn for event in events
    )


def test_empty_and_failed_transcriptions_are_stable_and_cancel_pending_commit() -> None:
    bridge = SenseAudioRealtimeBridge(
        model=_model(), instructions="", voice=SENSEAUDIO_DEFAULT_VOICE
    )
    bridge._handle_event({"type": "speech.started"})
    turn_id = bridge.outbound.get_nowait()["turn_id"]
    assert bridge.commit_input(turn_id) is True
    bridge._handle_event({"type": "user.transcript.done", "text": ""})
    assert bridge._pending_commit is None
    assert bridge.outbound.get_nowait() == {
        "type": "user_transcription_empty",
        "turn_id": turn_id,
    }

    bridge._handle_event({"type": "speech.started"})
    failed_turn_id = bridge.outbound.get_nowait()["turn_id"]
    bridge._handle_event(
        {
            "type": "user.transcript.failed",
            "code": "upstream-secret-code",
            "message": "internal-host.example secret-key",
        }
    )
    assert bridge.outbound.get_nowait() == {
        "type": "user_transcription_failed",
        "turn_id": failed_turn_id,
        "code": "voice_transcription_failed",
        "message": "本轮语音转写失败，请再说一次。",
    }


def test_provider_error_is_stable_and_does_not_leak_upstream_message() -> None:
    bridge = SenseAudioRealtimeBridge(
        model=_model(), instructions="", voice=SENSEAUDIO_DEFAULT_VOICE
    )
    bridge._handle_event(
        {
            "type": "error",
            "code": "internal_trace_42",
            "message": "secret-key failed at internal-host.example",
        }
    )
    event = bridge.outbound.get_nowait()
    assert event == {
        "type": "error",
        "code": "voice_provider_error",
        "message": "实时语音调用失败，请重新通话。",
        "retryable": True,
    }


@pytest.mark.asyncio
async def test_realtime_options_come_from_enabled_voice_capability() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_response = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": f"realtime-{uuid4()}",
                "kind": "senseaudio_realtime",
                "base_url": "wss://voice.example/realtime",
                "api_key": "options-secret",
                "enabled": True,
            },
        )
        assert provider_response.status_code == 200, provider_response.text
        provider_body = provider_response.json()
        provider = provider_body["provider"]
        model_response = await client.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "expected_catalog_revision": provider_body["revision"],
                "slug": "senseaudio-realtime-1.0",
                "label": "Realtime test",
                "description": "",
                "capabilities": ["voice"],
                "categories": ["end_to_end_speech"],
                "enabled": True,
            },
        )
        assert model_response.status_code == 200, model_response.text
        model = model_response.json()["model"]
        options = (await client.get("/v1/model-test/realtime-options")).json()
        selected = next(item for item in options["models"] if item["id"] == model["id"])
        assert selected["input_sample_rate"] == 16_000
        assert selected["output_sample_rate"] == 24_000
        assert selected["commit_silence_ms"] == 400
        assert selected["supports_interruption"] is True
        assert len(selected["voices"]) == 15
        assert "options-secret" not in json.dumps(options)

        revision = (await client.get("/v1/model-providers")).json()["revision"]
        deleted = await client.delete(
            f"/v1/model-providers/{provider['id']}",
            params={"expected_catalog_revision": revision},
        )
        assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_realtime_log_contains_metrics_but_not_transcripts() -> None:
    trace_id = f"realtime-log-{uuid4()}"
    turn = TurnMetrics(
        turn_id="turn",
        input_bytes=32_000,
        output_bytes=48_000,
        user_chars=7,
        assistant_chars=11,
        usage={"input_tokens": 2, "output_tokens": 3},
        timings={"provider_ms": 240},
    )
    turn.first_audio_at = turn.started_at + 0.25
    await _write_log(
        workspace_id="default",
        trace_id=trace_id,
        model=SimpleNamespace(provider_kind="senseaudio_realtime", slug="senseaudio-realtime-1.0"),
        voice=SENSEAUDIO_DEFAULT_VOICE,
        instructions_length=10,
        turn=turn,
        status="success",
    )
    async with SessionLocal() as session:
        row = (
            await session.execute(select(LlmCallLog).where(LlmCallLog.trace_id == trace_id))
        ).scalar_one()
        serialized = json.dumps(
            {"request": row.request_payload, "response": row.response_payload},
            ensure_ascii=False,
        )
        assert row.request_payload["input_audio_ms"] == 1_000
        assert row.response_payload["output_audio_ms"] == 1_000
        assert row.response_payload["user_transcript_chars"] == 7
        assert row.response_payload["assistant_transcript_chars"] == 11
        assert row.response_payload["first_audio_latency_ms"] == 250
        assert row.response_payload["total_duration_ms"] >= 250
        assert row.response_payload["usage"] == {
            "input_tokens": 2,
            "output_tokens": 3,
        }
        assert "transcript" not in serialized.replace("transcript_chars", "")
        assert "secret" not in serialized
        await session.delete(row)
        await session.commit()


def test_realtime_websocket_rejects_origin_and_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.routes.models.model_test_realtime as route

    @asynccontextmanager
    async def session_local():
        yield object()

    async def unauthorized(*_args):
        raise HTTPException(401)

    monkeypatch.setattr(route, "SessionLocal", session_local)
    monkeypatch.setattr(route, "authenticate_studio_websocket", unauthorized)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as missing_origin:
            with client.websocket_connect("/v1/model-test/realtime"):
                pass
        assert missing_origin.value.code == 4403
        with pytest.raises(WebSocketDisconnect) as missing_auth:
            with client.websocket_connect(
                "/v1/model-test/realtime", headers={"origin": "http://testserver"}
            ):
                pass
        assert missing_auth.value.code == 4401


def test_realtime_websocket_accepts_authenticated_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.routes.models.model_test_realtime as route

    @asynccontextmanager
    async def session_local():
        yield object()

    async def authenticated(*_args):
        return SimpleNamespace(workspace_id="workspace-a")

    async def run(websocket, *, workspace_id: str):
        await websocket.send_json({"type": "workspace", "id": workspace_id})
        await websocket.close(code=1000)

    monkeypatch.setattr(route, "SessionLocal", session_local)
    monkeypatch.setattr(route, "authenticate_studio_websocket", authenticated)
    monkeypatch.setattr(route, "run_realtime_model_test", run)
    with TestClient(app) as client:
        with client.websocket_connect(
            "/v1/model-test/realtime", headers={"origin": "http://testserver"}
        ) as websocket:
            assert websocket.receive_json() == {"type": "workspace", "id": "workspace-a"}
