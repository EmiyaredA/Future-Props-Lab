from __future__ import annotations

import asyncio
import base64
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.llm.models import LlmCallLog, ModelTestTool, ModelTestToolCall
from app.llm.playground.test_tools import (
    TestToolSelectionError as ToolSelectionError,
)
from app.llm.playground.test_tools import (
    load_selected_tool_snapshots,
    tool_snapshot,
)
from app.llm.providers.realtime.constants import (
    SENSEAUDIO_DEFAULT_VOICE,
    SENSEAUDIO_PCM_FRAME_BYTES,
    SENSEAUDIO_PCM_FRAME_SECONDS,
)
from app.llm.providers.realtime.contracts import ResolvedRealtimeModel
from app.llm.providers.realtime.senseaudio import SenseAudioRealtimeBridge
from app.llm.realtime.session import TurnMetrics, _client_configuration, _write_log
from app.llm.realtime.tool_calls import RealtimeToolExecutor, provider_tool_definitions
from app.main import app
from app.orm import bind_workspace
from app.runtime.db import SessionLocal


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
        greeting="你好，我是语音助手。",
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
            "greeting": "你好，我是语音助手。",
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


def test_senseaudio_normalizes_tool_calls_and_queues_results() -> None:
    tools = [
        {
            "type": "function",
            "name": "get_weather",
            "description": "查询天气",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
            },
        }
    ]
    bridge = SenseAudioRealtimeBridge(
        model=_model(),
        instructions="",
        voice=SENSEAUDIO_DEFAULT_VOICE,
        tools=tools,
    )
    bridge._handle_event({"type": "speech.started"})
    turn_id = bridge.outbound.get_nowait()["turn_id"]
    bridge._handle_event(
        {
            "type": "tool.call",
            "call_id": "call-weather",
            "name": "get_weather",
            "arguments": {"city": "上海"},
        }
    )
    assert bridge.outbound.get_nowait() == {
        "type": "tool_call",
        "turn_id": turn_id,
        "batch_id": "",
        "call_id": "call-weather",
        "name": "get_weather",
        "arguments": {"city": "上海"},
        "timeout_ms": None,
    }
    bridge.submit_tool_result("call-weather", {"weather": "晴"}, None)
    assert bridge._command_queue.get_nowait() == {
        "type": "tool.result",
        "call_id": "call-weather",
        "result": {"weather": "晴"},
    }


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
        assert selected["supports_tools"] is True
        assert selected["instructions_max_chars"] == 20_000
        assert selected["greeting_max_chars"] == 2_000
        assert selected["input_format"] == "pcm_s16le"
        assert selected["output_format"] == "pcm_s16le"
        assert selected["channels"] == 1
        assert selected["client_vad"]["positive_speech_threshold"]["default"] == 0.55
        assert selected["client_vad"]["negative_speech_threshold"]["default"] == 0.38
        assert selected["client_vad"]["min_speech_ms"]["default"] == 320
        assert selected["client_vad"]["pre_speech_pad_ms"]["default"] == 160
        assert selected["playback"]["start_buffer_ms"]["default"] == 400
        assert selected["playback"]["recovery_buffer_ms"]["default"] == 800
        assert selected["microphone"] == {
            "echo_cancellation": True,
            "noise_suppression": True,
            "auto_gain_control": True,
        }
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
        tool_calls=[
            {
                "call_id": "call-weather",
                "name": "get_weather",
                "status": "completed",
                "duration_ms": 128,
            }
        ],
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
        greeting_length=4,
        client_configuration={"interruption_enabled": True},
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
        assert row.request_payload["greeting_length"] == 4
        assert row.request_payload["client_configuration"] == {"interruption_enabled": True}
        assert row.response_payload["output_audio_ms"] == 1_000
        assert row.response_payload["user_transcript_chars"] == 7
        assert row.response_payload["assistant_transcript_chars"] == 11
        assert row.response_payload["first_audio_latency_ms"] == 250
        assert row.response_payload["total_duration_ms"] >= 250
        assert row.response_payload["usage"] == {
            "input_tokens": 2,
            "output_tokens": 3,
        }
        assert row.response_payload["tool_calls"] == [
            {
                "call_id": "call-weather",
                "name": "get_weather",
                "status": "completed",
                "duration_ms": 128,
            }
        ]
        assert "transcript" not in serialized.replace("transcript_chars", "")
        assert "secret" not in serialized
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            detail = await client.get(f"/v1/llm-call-logs/{row.id}")
            assert detail.json()["reproduction_supported"] is False
            reproduction = await client.get(f"/v1/llm-call-logs/{row.id}/reproduction-bundle")
            assert reproduction.status_code == 409
            assert reproduction.json()["code"] == "reproduction_unavailable"
        await session.delete(row)
        await session.commit()


@pytest.mark.asyncio
async def test_realtime_tool_selection_is_workspace_scoped_and_enabled() -> None:
    tool = ModelTestTool(
        name=f"weather_{uuid4().hex[:8]}",
        description="查询天气",
        input_schema={
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
        mock_kind="success",
        mock_result={"weather": "晴"},
        enabled=True,
    )
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        session.add(tool)
        await session.commit()
        snapshots = await load_selected_tool_snapshots(session, [tool.id])
        assert provider_tool_definitions(snapshots)[0] == {
            "type": "function",
            "name": tool.name,
            "description": "查询天气",
            "parameters": tool.input_schema,
        }

    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "other-workspace")
        with pytest.raises(ToolSelectionError):
            await load_selected_tool_snapshots(session, [tool.id])

    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        stored = await session.get(ModelTestTool, tool.id)
        assert stored is not None
        stored.enabled = False
        await session.commit()
        with pytest.raises(ToolSelectionError):
            await load_selected_tool_snapshots(session, [tool.id])
        await session.delete(stored)
        await session.commit()


@pytest.mark.asyncio
async def test_realtime_tool_executor_persists_full_success_and_returns_mock_json() -> None:
    tool = ModelTestTool(
        name=f"weather_{uuid4().hex[:8]}",
        description="查询天气",
        input_schema={
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
        mock_kind="success",
        mock_result={"weather": "晴", "temperature": 24},
        enabled=True,
    )
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        session.add(tool)
        await session.commit()
        snapshot = tool_snapshot(tool)

    updates: list[dict] = []
    provider_results: list[tuple[str, object | None, dict | None]] = []
    executor = RealtimeToolExecutor(
        workspace_id="default",
        trace_id=f"voice-{uuid4().hex[:24]}",
        snapshots=(snapshot,),
        emit=updates.append,
        submit_result=lambda call_id, result, error: provider_results.append(
            (call_id, result, error)
        ),
    )
    executor.start(
        {
            "turn_id": "turn-weather",
            "call_id": "call-weather",
            "name": tool.name,
            "arguments": {"city": "上海"},
        },
        round_index=0,
    )
    while executor.tasks:
        await asyncio.sleep(0)

    assert [update["status"] for update in updates] == ["running", "completed"]
    assert provider_results == [("call-weather", {"weather": "晴", "temperature": 24}, None)]
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        row = await session.scalar(
            select(ModelTestToolCall).where(
                ModelTestToolCall.action_id == "call-weather",
                ModelTestToolCall.tool_id == tool.id,
            )
        )
        assert row is not None
        assert row.source == "realtime_voice"
        assert row.arguments == {"city": "上海"}
        assert row.result == {"weather": "晴", "temperature": 24}
        assert row.status == "completed"
        assert row.success is True
        await session.delete(row)
        stored_tool = await session.get(ModelTestTool, tool.id)
        assert stored_tool is not None
        await session.delete(stored_tool)
        await session.commit()


@pytest.mark.asyncio
async def test_realtime_tool_executor_handles_concurrent_failure_size_and_cancel() -> None:
    oversized = {
        "id": None,
        "name": "oversized_result",
        "description": "返回超大结果",
        "input_schema": {"type": "object", "properties": {}},
        "mock_kind": "success",
        "mock_result": {"content": "x" * 33_000},
        "delay_ms": 0,
        "enabled": True,
        "revision": 0,
    }
    validation = {
        **oversized,
        "name": "validate_city",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
        "mock_result": {"weather": "晴"},
    }
    delayed = {
        **oversized,
        "name": "slow_tool",
        "mock_result": {"ok": True},
        "delay_ms": 1_000,
    }
    updates: list[dict] = []
    provider_results: list[tuple[str, object | None, dict | None]] = []
    executor = RealtimeToolExecutor(
        workspace_id="default",
        trace_id=f"voice-{uuid4().hex[:24]}",
        snapshots=(oversized, validation, delayed),
        emit=updates.append,
        submit_result=lambda call_id, result, error: provider_results.append(
            (call_id, result, error)
        ),
    )
    for call_id, name in (
        ("call-large", "oversized_result"),
        ("call-invalid", "validate_city"),
        ("call-cancel", "slow_tool"),
    ):
        executor.start(
            {
                "turn_id": "turn-tools",
                "call_id": call_id,
                "name": name,
                "arguments": {},
            },
            round_index=1,
        )
    for _ in range(100):
        if any(
            update["call_id"] == "call-cancel" and update["status"] == "running"
            for update in updates
        ):
            break
        await asyncio.sleep(0)
    await executor.cancel("call-cancel", "provider timeout")
    while executor.tasks:
        await asyncio.sleep(0)

    terminal = {
        update["call_id"]: update
        for update in updates
        if update["status"] in {"completed", "failed", "cancelled"}
    }
    assert terminal["call-large"]["error_code"] == "tool_result_too_large"
    assert len(terminal["call-large"]["result"]["content"]) == 33_000
    assert terminal["call-invalid"]["error_code"] == "invalid_arguments"
    assert terminal["call-cancel"]["status"] == "cancelled"
    assert terminal["call-cancel"]["error_message"] == "provider timeout"
    assert {call_id for call_id, _result, _error in provider_results} == {
        "call-large",
        "call-invalid",
    }
    assert all(error is not None for _call_id, _result, error in provider_results)

    async with SessionLocal() as session:
        bind_workspace(session.sync_session, "default")
        rows = list(
            (
                await session.execute(
                    select(ModelTestToolCall).where(
                        ModelTestToolCall.action_id.in_(
                            ["call-large", "call-invalid", "call-cancel"]
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {row.action_id: row.status for row in rows} == {
            "call-large": "failed",
            "call-invalid": "failed",
            "call-cancel": "cancelled",
        }
        large_row = next(row for row in rows if row.action_id == "call-large")
        assert len(large_row.result["content"]) == 33_000
        for row in rows:
            await session.delete(row)
        await session.commit()


def test_realtime_client_parameters_are_validated_and_normalized() -> None:
    configuration = _client_configuration(
        {
            "client_vad": {
                "positive_speech_threshold": 0.7,
                "negative_speech_threshold": 0.25,
                "min_speech_ms": 640,
                "pre_speech_pad_ms": 192,
                "commit_silence_ms": 550,
            },
            "playback": {
                "start_buffer_ms": 300,
                "recovery_buffer_ms": 900,
            },
            "microphone": {
                "echo_cancellation": False,
                "noise_suppression": True,
                "auto_gain_control": False,
            },
            "interruption_enabled": False,
        }
    )
    assert configuration["client_vad"]["commit_silence_ms"] == 550
    assert configuration["playback"] == {
        "start_buffer_ms": 300,
        "recovery_buffer_ms": 900,
    }
    assert configuration["microphone"]["echo_cancellation"] is False
    assert configuration["interruption_enabled"] is False

    with pytest.raises(ValueError):
        _client_configuration(
            {
                "client_vad": {
                    "positive_speech_threshold": 0.3,
                    "negative_speech_threshold": 0.4,
                }
            }
        )


def test_realtime_websocket_rejects_origin_and_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.llm.routes.models.model_test_realtime as route

    async def unauthorized(*_args):
        raise HTTPException(401)

    monkeypatch.setattr(route, "resolve_studio_websocket_principal", unauthorized)
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
    import app.llm.routes.models.model_test_realtime as route

    async def authenticated(*_args):
        return SimpleNamespace(
            workspace_id="workspace-a",
            session_id="session-a",
            auth_kind="session",
            api_key_id=None,
            allows=lambda _permission: True,
        )

    async def run(websocket, *, workspace_id: str, check_access, credential):
        assert credential.auth_kind == "session"
        await check_access()
        await websocket.send_json({"type": "workspace", "id": workspace_id})
        await websocket.close(code=1000)

    monkeypatch.setattr(route, "resolve_studio_websocket_principal", authenticated)
    monkeypatch.setattr(route, "run_realtime_model_test", run)
    with TestClient(app) as client:
        with client.websocket_connect(
            "/v1/model-test/realtime", headers={"origin": "http://testserver"}
        ) as websocket:
            assert websocket.receive_json() == {"type": "workspace", "id": "workspace-a"}
