from __future__ import annotations

import asyncio
import base64
import binascii
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from app.llm.credential_snapshot import CredentialSnapshot
from app.llm.models import LlmCallLog
from app.llm.providers.realtime.constants import (
    SENSEAUDIO_DEFAULT_VOICE,
    SENSEAUDIO_VOICE_IDS,
    VOICE_COMMIT_SILENCE_MS,
    VOICE_GREETING_MAX_CHARS,
    VOICE_INPUT_SAMPLE_RATE,
    VOICE_INSTRUCTIONS_MAX_CHARS,
    VOICE_OUTPUT_SAMPLE_RATE,
    VOICE_PLAYBACK_RECOVERY_BUFFER_MS,
    VOICE_PLAYBACK_START_BUFFER_MS,
    VOICE_VAD_MIN_SPEECH_MS,
    VOICE_VAD_NEGATIVE_THRESHOLD,
    VOICE_VAD_POSITIVE_THRESHOLD,
    VOICE_VAD_PRE_SPEECH_PAD_MS,
)
from app.llm.providers.realtime.contracts import RealtimeProviderUnavailableError
from app.llm.providers.realtime.senseaudio import SenseAudioRealtimeBridge
from app.llm.realtime.catalog import RealtimeModelUnavailableError, resolve_realtime_model
from app.runtime.ids import new_id
from app.runtime.ownership import bind_owner

PERMISSION_RECHECK_SECONDS = 5


@dataclass(slots=True)
class TurnMetrics:
    turn_id: str
    started_at: float = field(default_factory=time.monotonic)
    input_bytes: int = 0
    output_bytes: int = 0
    user_chars: int = 0
    assistant_chars: int = 0
    first_audio_at: float = 0.0
    usage: dict[str, Any] = field(default_factory=dict)
    timings: dict[str, Any] = field(default_factory=dict)


async def _write_log(
    *,
    session_factory,
    owner_user_id: str,
    trace_id: str,
    model: Any,
    voice: str,
    instructions_length: int,
    turn: TurnMetrics | None,
    status: str,
    error_message: str | None = None,
    greeting_length: int = 0,
    client_configuration: dict[str, Any] | None = None,
    credential: CredentialSnapshot | None = None,
) -> None:
    now = time.monotonic()
    usage = turn.usage if turn else {}
    prompt_tokens = _optional_int(usage.get("input_tokens") or usage.get("prompt_tokens"))
    completion_tokens = _optional_int(usage.get("output_tokens") or usage.get("completion_tokens"))
    total_tokens = _optional_int(usage.get("total_tokens"))
    if total_tokens is None and (prompt_tokens is not None or completion_tokens is not None):
        total_tokens = int(prompt_tokens or 0) + int(completion_tokens or 0)
    latency_ms = 0
    if turn:
        end = turn.first_audio_at or now
        latency_ms = max(0, round((end - turn.started_at) * 1000))
    total_duration_ms = (
        max(0, round((max(now, turn.first_audio_at) - turn.started_at) * 1000)) if turn else 0
    )
    snap = credential or CredentialSnapshot()
    async with session_factory() as session:
        bind_owner(session, owner_user_id)
        session.add(
            LlmCallLog(
                call_source="model_playground",
                provider_kind=model.provider_kind,
                model=model.slug,
                trace_id=trace_id,
                request_payload={
                    "mode": "realtime_voice",
                    "voice": voice,
                    "instructions_length": instructions_length,
                    "greeting_length": greeting_length,
                    "client_configuration": client_configuration or {},
                    "input_audio_ms": (
                        round(turn.input_bytes / 2 / VOICE_INPUT_SAMPLE_RATE * 1000) if turn else 0
                    ),
                },
                response_payload={
                    "user_transcript_chars": turn.user_chars if turn else 0,
                    "assistant_transcript_chars": turn.assistant_chars if turn else 0,
                    "first_audio_latency_ms": latency_ms,
                    "total_duration_ms": total_duration_ms,
                    "output_audio_ms": (
                        round(turn.output_bytes / 2 / VOICE_OUTPUT_SAMPLE_RATE * 1000)
                        if turn
                        else 0
                    ),
                    "usage": usage,
                    "timings": turn.timings if turn else {},
                },
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                status=status,
                error_message=error_message,
                **snap.as_kwargs(),
            )
        )
        await session.commit()


def _optional_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _group(payload: dict[str, Any], name: str) -> dict[str, Any]:
    value = payload.get(name)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError
    return value


def _number(
    group: dict[str, Any],
    name: str,
    default: float,
    minimum: float,
    maximum: float,
    *,
    integer: bool = False,
) -> float | int:
    value = group.get(name, default)
    if isinstance(value, bool):
        raise ValueError
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError from exc
    if number < minimum or number > maximum:
        raise ValueError
    return int(round(number)) if integer else number


def _boolean(group: dict[str, Any], name: str, default: bool) -> bool:
    value = group.get(name, default)
    if not isinstance(value, bool):
        raise ValueError
    return value


def _client_configuration(payload: dict[str, Any]) -> dict[str, Any]:
    vad = _group(payload, "client_vad")
    playback = _group(payload, "playback")
    microphone = _group(payload, "microphone")
    positive = _number(vad, "positive_speech_threshold", VOICE_VAD_POSITIVE_THRESHOLD, 0.05, 1)
    negative = _number(vad, "negative_speech_threshold", VOICE_VAD_NEGATIVE_THRESHOLD, 0, 0.95)
    if negative >= positive:
        raise ValueError
    start_buffer = _number(
        playback,
        "start_buffer_ms",
        VOICE_PLAYBACK_START_BUFFER_MS,
        0,
        2_000,
        integer=True,
    )
    recovery_buffer = _number(
        playback,
        "recovery_buffer_ms",
        VOICE_PLAYBACK_RECOVERY_BUFFER_MS,
        0,
        3_000,
        integer=True,
    )
    if recovery_buffer < start_buffer:
        raise ValueError
    return {
        "client_vad": {
            "positive_speech_threshold": positive,
            "negative_speech_threshold": negative,
            "min_speech_ms": _number(
                vad,
                "min_speech_ms",
                VOICE_VAD_MIN_SPEECH_MS,
                64,
                5_000,
                integer=True,
            ),
            "pre_speech_pad_ms": _number(
                vad,
                "pre_speech_pad_ms",
                VOICE_VAD_PRE_SPEECH_PAD_MS,
                0,
                2_000,
                integer=True,
            ),
            "commit_silence_ms": _number(
                vad,
                "commit_silence_ms",
                VOICE_COMMIT_SILENCE_MS,
                100,
                5_000,
                integer=True,
            ),
        },
        "playback": {
            "start_buffer_ms": start_buffer,
            "recovery_buffer_ms": recovery_buffer,
        },
        "microphone": {
            "echo_cancellation": _boolean(microphone, "echo_cancellation", True),
            "noise_suppression": _boolean(microphone, "noise_suppression", True),
            "auto_gain_control": _boolean(microphone, "auto_gain_control", True),
        },
        "interruption_enabled": _boolean(payload, "interruption_enabled", True),
    }


async def run_realtime_model_test(
    websocket: WebSocket,
    *,
    owner_user_id: str,
    session_factory,
    check_access=None,
    credential: CredentialSnapshot | None = None,
) -> None:
    trace_id = new_id()
    model: Any | None = None
    bridge: SenseAudioRealtimeBridge | None = None
    voice = SENSEAUDIO_DEFAULT_VOICE
    instructions = ""
    greeting = ""
    client_configuration: dict[str, Any] = {}
    turns: dict[str, TurnMetrics] = {}
    active_turn_id: str | None = None
    logged_turns = 0
    try:
        try:
            start = await asyncio.wait_for(websocket.receive_json(), timeout=15)
        except TimeoutError:
            await websocket.send_json(_error("voice_start_timeout", "等待通话配置超时。", True))
            return
        if not isinstance(start, dict) or start.get("type") != "start":
            await websocket.send_json(_error("voice_start_required", "首条消息必须启动通话。"))
            return
        if check_access is not None:
            await check_access()
        model_id = str(start.get("model_id") or "").strip()
        instructions = str(start.get("instructions") or "").strip()
        if len(instructions) > VOICE_INSTRUCTIONS_MAX_CHARS:
            await websocket.send_json(
                _error("voice_instructions_too_long", "系统提示词不能超过 20000 字。")
            )
            return
        greeting = str(start.get("greeting") or "").strip()
        if len(greeting) > VOICE_GREETING_MAX_CHARS:
            await websocket.send_json(_error("voice_greeting_too_long", "开场白不能超过 2000 字。"))
            return
        try:
            client_configuration = _client_configuration(start)
        except ValueError:
            await websocket.send_json(
                _error("voice_parameters_invalid", "实时语音参数超出允许范围。")
            )
            return
        requested_voice = str(start.get("voice") or "").strip()
        voice = (
            requested_voice if requested_voice in SENSEAUDIO_VOICE_IDS else SENSEAUDIO_DEFAULT_VOICE
        )
        async with session_factory() as session:
            bind_owner(session.sync_session, owner_user_id)
            model = await resolve_realtime_model(
                session, owner_user_id=owner_user_id, model_id=model_id
            )
        bridge = SenseAudioRealtimeBridge(
            model=model,
            instructions=instructions,
            greeting=greeting,
            voice=voice,
        )

        await bridge.start()
        await websocket.send_json(
            {
                "type": "call_started",
                "session_id": bridge.session_id,
                "trace_id": trace_id,
                "model": model.slug,
                "voice": voice,
                "input_sample_rate": VOICE_INPUT_SAMPLE_RATE,
                "output_sample_rate": VOICE_OUTPUT_SAMPLE_RATE,
                "commit_silence_ms": VOICE_COMMIT_SILENCE_MS,
                "supports_interruption": True,
                "client_configuration": client_configuration,
            }
        )

        async def receive_client() -> None:
            nonlocal active_turn_id
            while True:
                payload = await websocket.receive_json()
                if not isinstance(payload, dict):
                    continue
                kind = str(payload.get("type") or "")
                if kind == "audio":
                    data = str(payload.get("data") or "")
                    if len(data) > 700_000:
                        await websocket.send_json(
                            _error("voice_audio_too_large", "单个音频分片过大。")
                        )
                        continue
                    try:
                        byte_count = len(base64.b64decode(data, validate=True))
                    except (ValueError, binascii.Error):
                        byte_count = 0
                    if active_turn_id and active_turn_id in turns:
                        turns[active_turn_id].input_bytes += byte_count
                    bridge.append_audio(data)
                elif kind == "commit_input":
                    if check_access is not None:
                        await check_access()
                    bridge.commit_input(str(payload.get("turn_id") or ""))
                elif kind == "interrupt":
                    bridge.interrupt(str(payload.get("turn_id") or ""))
                elif kind == "mute":
                    continue
                elif kind == "stop":
                    return

        async def send_provider() -> None:
            nonlocal active_turn_id, logged_turns
            while True:
                event = await bridge.outbound.get()
                event_type = str(event.get("type") or "")
                turn_id = str(event.get("turn_id") or "")
                if event_type == "provider_closed":
                    event = _error(
                        "voice_provider_disconnected",
                        "实时语音连接已断开。",
                        True,
                    )
                    event_type = "error"
                if event_type == "user_speech_started" and turn_id:
                    active_turn_id = turn_id
                    turns[turn_id] = TurnMetrics(turn_id=turn_id)
                elif event_type == "user_transcript" and turn_id:
                    turns.setdefault(turn_id, TurnMetrics(turn_id)).user_chars = len(
                        str(event.get("text") or "")
                    )
                elif event_type == "assistant_transcript_done" and turn_id:
                    turns.setdefault(turn_id, TurnMetrics(turn_id)).assistant_chars = len(
                        str(event.get("text") or "")
                    )
                elif event_type == "audio" and turn_id:
                    turn = turns.setdefault(turn_id, TurnMetrics(turn_id))
                    if not turn.first_audio_at:
                        turn.first_audio_at = time.monotonic()
                    try:
                        turn.output_bytes += len(
                            base64.b64decode(str(event.get("data") or ""), validate=True)
                        )
                    except (ValueError, binascii.Error):
                        pass
                elif event_type == "turn_done" and turn_id:
                    turn = turns.setdefault(turn_id, TurnMetrics(turn_id))
                    turn.usage = dict(event.get("usage") or {})
                    turn.timings = dict(event.get("timings") or {})
                    await _write_log(
                        session_factory=session_factory,
                        owner_user_id=owner_user_id,
                        trace_id=trace_id,
                        model=model,
                        voice=voice,
                        instructions_length=len(instructions),
                        turn=turn,
                        status="success",
                        greeting_length=len(greeting),
                        client_configuration=client_configuration,
                        credential=credential,
                    )
                    logged_turns += 1
                    active_turn_id = None
                elif event_type == "error":
                    turn = turns.get(active_turn_id or "")
                    await _write_log(
                        session_factory=session_factory,
                        owner_user_id=owner_user_id,
                        trace_id=trace_id,
                        model=model,
                        voice=voice,
                        instructions_length=len(instructions),
                        turn=turn,
                        status="error",
                        error_message=str(event.get("message") or "实时语音调用失败"),
                        greeting_length=len(greeting),
                        client_configuration=client_configuration,
                        credential=credential,
                    )
                    logged_turns += 1
                    active_turn_id = None
                await websocket.send_json(event)
                if event_type == "error":
                    return

        async def watch_access():
            while True:
                await asyncio.sleep(PERMISSION_RECHECK_SECONDS)
                if check_access is not None:
                    await check_access()

        client_task = asyncio.create_task(receive_client(), name="realtime-browser-inbound")
        provider_task = asyncio.create_task(send_provider(), name="realtime-browser-outbound")
        tasks = {client_task, provider_task}
        if check_access is not None:
            tasks.add(asyncio.create_task(watch_access(), name="realtime-permission-watch"))
        try:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            if not task.cancelled():
                task.result()
        if active_turn_id:
            await _write_log(
                session_factory=session_factory,
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                model=model,
                voice=voice,
                instructions_length=len(instructions),
                turn=turns.get(active_turn_id),
                status="error",
                error_message="实时语音通话已结束。",
                greeting_length=len(greeting),
                client_configuration=client_configuration,
                credential=credential,
            )
            logged_turns += 1
            active_turn_id = None
    except WebSocketDisconnect:
        if model is not None and active_turn_id:
            await _write_log(
                session_factory=session_factory,
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                model=model,
                voice=voice,
                instructions_length=len(instructions),
                turn=turns.get(active_turn_id),
                status="error",
                error_message="实时语音连接已断开。",
                greeting_length=len(greeting),
                client_configuration=client_configuration,
                credential=credential,
            )
            logged_turns += 1
            active_turn_id = None
    except (RealtimeModelUnavailableError, RealtimeProviderUnavailableError) as exc:
        if model is None:
            model = getattr(exc, "model", None)
        if model is not None and logged_turns == 0:
            await _write_log(
                session_factory=session_factory,
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                model=model,
                voice=voice,
                instructions_length=len(instructions),
                turn=None,
                status="error",
                error_message=str(exc),
                greeting_length=len(greeting),
                client_configuration=client_configuration,
                credential=credential,
            )
        await _safe_send(
            websocket,
            _error(
                str(getattr(exc, "code", "voice_unavailable")),
                str(exc),
                bool(getattr(exc, "retryable", True)),
            ),
        )
    except Exception:
        if model is not None and logged_turns == 0:
            await _write_log(
                session_factory=session_factory,
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                model=model,
                voice=voice,
                instructions_length=len(instructions),
                turn=None,
                status="error",
                error_message="实时语音会话异常结束，请重新通话。",
                greeting_length=len(greeting),
                client_configuration=client_configuration,
                credential=credential,
            )
        await _safe_send(
            websocket,
            _error("voice_session_failed", "实时语音会话异常结束，请重新通话。", True),
        )
    finally:
        if bridge is not None:
            await bridge.close()
        await _safe_send(websocket, {"type": "call_ended"})


def _error(code: str, message: str, retryable: bool = False) -> dict[str, Any]:
    return {"type": "error", "code": code, "message": message, "retryable": retryable}


async def _safe_send(websocket: WebSocket, event: dict[str, Any]) -> None:
    try:
        await websocket.send_json(event)
    except (RuntimeError, WebSocketDisconnect):
        pass
