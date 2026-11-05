from __future__ import annotations

import asyncio
import base64
import binascii
import json
import time
from collections.abc import Callable
from typing import Any

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from studio.apps.model_service.providers.realtime.constants import (
    SENSEAUDIO_PCM_FRAME_BYTES,
    SENSEAUDIO_PCM_FRAME_SECONDS,
    SENSEAUDIO_PCM_SILENCE_FRAME,
    SENSEAUDIO_REALTIME_URL,
    SENSEAUDIO_UPLINK_QUEUE_FRAMES,
    SENSEAUDIO_VOICE_IDS,
)
from studio.apps.model_service.providers.realtime.contracts import (
    RealtimeProviderUnavailableError,
    ResolvedRealtimeModel,
)
from studio.runtime.http.outbound_urls import require_safe_provider_websocket_url
from studio.runtime.ids import new_id


class SenseAudioRealtimeBridge:
    """Provider adapter for SenseAudio's JSON-control/raw-PCM WebSocket protocol."""

    def __init__(
        self,
        *,
        model: ResolvedRealtimeModel,
        instructions: str,
        greeting: str = "",
        voice: str,
        connector: Callable[..., Any] = connect,
    ) -> None:
        self.model = model
        self.instructions = instructions
        self.greeting = greeting
        self.voice = voice if voice in SENSEAUDIO_VOICE_IDS else ""
        self.connector = connector
        self.outbound: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.session_id = ""
        self._connection: Any | None = None
        self._ready = asyncio.Event()
        self._closed = asyncio.Event()
        self._audio_queue: asyncio.Queue[tuple[int, bytes]] = asyncio.Queue(
            maxsize=SENSEAUDIO_UPLINK_QUEUE_FRAMES
        )
        self._command_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._audio_buffer = bytearray()
        self._enqueued_watermark = 0
        self._sent_watermark = 0
        self._pending_commit: tuple[str, int] | None = None
        self._committed_turns: set[str] = set()
        self._current_turn_id: str | None = None
        self._assistant_turn_id: str | None = None
        self._assistant_text = ""
        self._cancelled_turn_id: str | None = None
        self._cancel_fence = False
        self._new_response_allowed = False
        self._tasks: list[asyncio.Task[Any]] = []

    async def start(self) -> None:
        if not self.model.api_key:
            raise RealtimeProviderUnavailableError(
                "SenseAudio API Key 未配置",
                code="voice_key_missing",
                retryable=False,
            )
        endpoint = require_safe_provider_websocket_url(
            self.model.base_url or SENSEAUDIO_REALTIME_URL
        )
        try:
            self._connection = await self.connector(
                endpoint,
                additional_headers={"Authorization": f"Bearer {self.model.api_key}"},
                open_timeout=10,
                close_timeout=3,
                max_size=None,
            )
        except InvalidStatus as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 401:
                raise RealtimeProviderUnavailableError(
                    "SenseAudio API Key 无效",
                    code="voice_auth_failed",
                    retryable=False,
                ) from exc
            if status == 429:
                raise RealtimeProviderUnavailableError(
                    "SenseAudio 实时语音请求过于频繁",
                    code="voice_rate_limited",
                ) from exc
            raise RealtimeProviderUnavailableError(
                "SenseAudio 实时语音连接失败",
                code="voice_provider_connect_failed",
            ) from exc
        except Exception as exc:
            raise RealtimeProviderUnavailableError(
                "SenseAudio 实时语音连接失败",
                code="voice_provider_connect_failed",
            ) from exc

        await self._connection.send(json.dumps(self._start_command(), ensure_ascii=False))
        self._tasks = [
            asyncio.create_task(self._send_loop(), name="senseaudio-realtime-send"),
            asyncio.create_task(self._receive_loop(), name="senseaudio-realtime-receive"),
        ]
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=15)
        except TimeoutError as exc:
            await self.close()
            raise RealtimeProviderUnavailableError(
                "SenseAudio Realtime ready 超时",
                code="voice_provider_timeout",
            ) from exc

    def _start_command(self) -> dict[str, Any]:
        command: dict[str, Any] = {
            "type": "start",
            "model": self.model.slug,
            "instructions": self.instructions,
            "greeting": self.greeting,
            "audio_setting": {
                "sample_rate": 16_000,
                "format": "pcm_s16le",
                "channel": 1,
            },
        }
        if self.voice:
            command["voice"] = self.voice
        return command

    def append_audio(self, audio_b64: str) -> None:
        if self._closed.is_set():
            return
        try:
            raw = base64.b64decode(audio_b64, validate=True)
        except (ValueError, binascii.Error):
            self._emit_error("voice_audio_invalid", "麦克风音频格式无效，请重新通话。", False)
            return
        self._audio_buffer.extend(raw)
        while len(self._audio_buffer) >= SENSEAUDIO_PCM_FRAME_BYTES:
            frame = bytes(self._audio_buffer[:SENSEAUDIO_PCM_FRAME_BYTES])
            del self._audio_buffer[:SENSEAUDIO_PCM_FRAME_BYTES]
            self._enqueued_watermark += 1
            try:
                self._audio_queue.put_nowait((self._enqueued_watermark, frame))
            except asyncio.QueueFull:
                self._emit_error(
                    "voice_uplink_overloaded",
                    "实时语音上行速度异常，请重新通话。",
                    True,
                )
                asyncio.create_task(self.close())
                return

    def commit_input(self, turn_id: str | None) -> bool:
        expected = str(turn_id or "").strip()
        if (
            not expected
            or expected != self._current_turn_id
            or expected in self._committed_turns
            or self._pending_commit is not None
            or self._closed.is_set()
        ):
            return False
        if self._audio_buffer:
            padded = bytes(self._audio_buffer).ljust(SENSEAUDIO_PCM_FRAME_BYTES, b"\0")
            self._audio_buffer.clear()
            self._enqueued_watermark += 1
            try:
                self._audio_queue.put_nowait((self._enqueued_watermark, padded))
            except asyncio.QueueFull:
                return False
        self._pending_commit = (expected, self._enqueued_watermark)
        return True

    def interrupt(self, turn_id: str | None) -> str | None:
        expected = str(turn_id or "").strip()
        active = self._assistant_turn_id
        if not active or (expected and expected != active) or self._closed.is_set():
            return None
        if self._cancel_fence and self._cancelled_turn_id == active:
            return active
        self._cancelled_turn_id = active
        self._cancel_fence = True
        self._new_response_allowed = False
        self._command_queue.put_nowait({"type": "cancel"})
        self.outbound.put_nowait({"type": "interrupt", "turn_id": active})
        return active

    async def _send_loop(self) -> None:
        next_audio_at = time.monotonic() + SENSEAUDIO_PCM_FRAME_SECONDS
        try:
            while not self._closed.is_set() and self._connection is not None:
                while not self._command_queue.empty():
                    command = self._command_queue.get_nowait()
                    await self._connection.send(json.dumps(command, ensure_ascii=False))
                delay = next_audio_at - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                try:
                    watermark, frame = self._audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    watermark, frame = 0, SENSEAUDIO_PCM_SILENCE_FRAME
                await self._connection.send(frame)
                if watermark:
                    self._sent_watermark = max(self._sent_watermark, watermark)
                await self._maybe_send_commit()
                now = time.monotonic()
                next_audio_at += SENSEAUDIO_PCM_FRAME_SECONDS
                if next_audio_at <= now:
                    next_audio_at = now + SENSEAUDIO_PCM_FRAME_SECONDS
        except asyncio.CancelledError:
            raise
        except Exception:
            if not self._closed.is_set():
                self._emit_error("voice_provider_disconnected", "实时语音连接已断开。", True)

    async def _maybe_send_commit(self) -> None:
        pending = self._pending_commit
        if pending is None or self._connection is None:
            return
        turn_id, watermark = pending
        if self._sent_watermark < watermark:
            return
        self._pending_commit = None
        self._committed_turns.add(turn_id)
        await self._connection.send(json.dumps({"type": "commit"}))
        self.outbound.put_nowait({"type": "user_speech_stopped", "turn_id": turn_id})

    async def _receive_loop(self) -> None:
        try:
            assert self._connection is not None
            async for message in self._connection:
                if isinstance(message, bytes):
                    if not self._cancel_fence:
                        self.outbound.put_nowait(
                            {
                                "type": "audio",
                                "turn_id": self._assistant_turn_id or self._current_turn_id,
                                "data": base64.b64encode(message).decode("ascii"),
                            }
                        )
                    continue
                try:
                    event = json.loads(message)
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(event, dict):
                    self._handle_event(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            if not self._closed.is_set():
                self._emit_error("voice_provider_disconnected", "实时语音连接已断开。", True)
        finally:
            if not self._closed.is_set():
                self.outbound.put_nowait({"type": "provider_closed"})

    def _handle_event(self, event: dict[str, Any]) -> None:
        event_type = str(event.get("type") or "")
        if event_type == "ready":
            self.session_id = str(event.get("session_id") or "")
            self._ready.set()
            return
        if event_type == "speech.started":
            if self._assistant_turn_id:
                self.interrupt(self._assistant_turn_id)
            self._assistant_text = ""
            self._current_turn_id = new_id()
            self._committed_turns.intersection_update({self._current_turn_id})
            self.outbound.put_nowait(
                {"type": "user_speech_started", "turn_id": self._current_turn_id}
            )
            return
        if event_type == "speech.stopped":
            if self._current_turn_id:
                if self._pending_commit and self._pending_commit[0] == self._current_turn_id:
                    self._pending_commit = None
                self._committed_turns.add(self._current_turn_id)
                self.outbound.put_nowait(
                    {"type": "user_speech_stopped", "turn_id": self._current_turn_id}
                )
            return
        if event_type in {"user.transcript.delta", "user.transcript.done"}:
            text = str(event.get("text") or "")
            if event_type.endswith("done") and self._current_turn_id:
                if self._pending_commit and self._pending_commit[0] == self._current_turn_id:
                    self._pending_commit = None
                self._committed_turns.add(self._current_turn_id)
                if not text:
                    self.outbound.put_nowait(
                        {
                            "type": "user_transcription_empty",
                            "turn_id": self._current_turn_id,
                        }
                    )
                    return
            normalized = (
                "user_transcript_delta" if event_type.endswith("delta") else "user_transcript"
            )
            if event_type.endswith("done"):
                self._cancel_fence = False
                self._new_response_allowed = True
            self.outbound.put_nowait(
                {"type": normalized, "turn_id": self._current_turn_id, "text": text}
            )
            return
        if event_type == "user.transcript.failed":
            if self._current_turn_id:
                if self._pending_commit and self._pending_commit[0] == self._current_turn_id:
                    self._pending_commit = None
                self._committed_turns.add(self._current_turn_id)
            self.outbound.put_nowait(
                {
                    "type": "user_transcription_failed",
                    "turn_id": self._current_turn_id,
                    "code": "voice_transcription_failed",
                    "message": "本轮语音转写失败，请再说一次。",
                }
            )
            return
        if event_type.startswith("assistant."):
            if self._cancel_fence and not self._new_response_allowed:
                return
            self._cancel_fence = False
            self._new_response_allowed = False
            self._assistant_turn_id = self._current_turn_id or new_id()
            if event_type == "assistant.text.delta":
                text = str(event.get("text") or "")
                self._assistant_text += text
                self.outbound.put_nowait(
                    {
                        "type": "assistant_transcript_delta",
                        "turn_id": self._assistant_turn_id,
                        "text": text,
                    }
                )
            elif event_type == "assistant.text.done":
                text = str(event.get("text") or "") or self._assistant_text
                self.outbound.put_nowait(
                    {
                        "type": "assistant_transcript_done",
                        "turn_id": self._assistant_turn_id,
                        "text": text,
                    }
                )
            return
        if event_type == "turn.done":
            if self._cancel_fence:
                return
            turn_id = self._assistant_turn_id or self._current_turn_id
            self.outbound.put_nowait(
                {
                    "type": "turn_done",
                    "turn_id": turn_id,
                    "timings": (
                        event.get("timings") if isinstance(event.get("timings"), dict) else {}
                    ),
                    "usage": event.get("usage") if isinstance(event.get("usage"), dict) else {},
                }
            )
            self._assistant_turn_id = None
            self._assistant_text = ""
            return
        if event_type == "error":
            code = str(event.get("code") or "voice_provider_error")
            if code == "no_active_response":
                return
            public_code, public_message, retryable = _public_provider_error(code)
            self._emit_error(public_code, public_message, retryable)

    def _emit_error(self, code: str, message: str, retryable: bool) -> None:
        self.outbound.put_nowait(
            {"type": "error", "code": code, "message": message, "retryable": retryable}
        )

    async def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()
        if self._connection is not None:
            try:
                await self._connection.send(json.dumps({"type": "end"}))
            except Exception:
                pass
        current = asyncio.current_task()
        for task in self._tasks:
            if task is not current:
                task.cancel()
        await asyncio.gather(
            *(task for task in self._tasks if task is not current), return_exceptions=True
        )
        if self._connection is not None:
            try:
                await self._connection.close(code=1000)
            except Exception:
                pass


def _public_provider_error(code: str) -> tuple[str, str, bool]:
    normalized = code.lower()
    if normalized in {"unauthorized", "invalid_api_key", "authentication_failed"}:
        return "voice_auth_failed", "实时语音供应商鉴权失败，请检查 API Key。", False
    if normalized in {"rate_limit", "rate_limited", "too_many_requests"}:
        return "voice_rate_limited", "实时语音请求过于频繁，请稍后重试。", True
    if normalized in {"invalid_request", "protocol_error", "bad_request"}:
        return "voice_protocol_error", "实时语音供应商拒绝了当前会话配置。", False
    return "voice_provider_error", "实时语音调用失败，请重新通话。", True
