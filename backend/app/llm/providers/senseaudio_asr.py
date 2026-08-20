from __future__ import annotations

import math
from dataclasses import dataclass
from typing import BinaryIO

import httpx

from app.llm.providers._senseaudio import (
    SenseAudioProviderError,
    response_json,
    root_url,
)

MAX_ASR_FILE_BYTES = 10 * 1024 * 1024


class SenseAudioAsrFileTooLarge(SenseAudioProviderError):
    pass


@dataclass(frozen=True)
class SenseAudioTranscriptSegment:
    speaker: str
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class SenseAudioTranscription:
    text: str
    segments: tuple[SenseAudioTranscriptSegment, ...]


def _milliseconds(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        return None
    return round(numeric * 1000)


def _normalize_segments(value: object) -> tuple[SenseAudioTranscriptSegment, ...]:
    if not isinstance(value, list):
        return ()
    segments: list[SenseAudioTranscriptSegment] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        start_ms = _milliseconds(item.get("start"))
        end_ms = _milliseconds(item.get("end"))
        text = item.get("text")
        if (
            start_ms is None
            or end_ms is None
            or end_ms < start_ms
            or not isinstance(text, str)
            or not text.strip()
        ):
            continue
        speaker = item.get("speaker")
        segments.append(
            SenseAudioTranscriptSegment(
                speaker=speaker.strip()
                if isinstance(speaker, str) and speaker.strip()
                else "unknown",
                start_ms=start_ms,
                end_ms=end_ms,
                text=text.strip(),
            )
        )
    return tuple(sorted(segments, key=lambda segment: (segment.start_ms, segment.end_ms)))


async def transcribe_audio(
    *,
    base_url: str,
    api_key: str,
    model: str,
    filename: str,
    source: BinaryIO,
    mime_type: str,
    byte_size: int,
    language: str = "auto",
    transport: httpx.AsyncBaseTransport | None = None,
) -> SenseAudioTranscription:
    if byte_size > MAX_ASR_FILE_BYTES:
        raise SenseAudioAsrFileTooLarge("SenseAudio 语音识别仅支持不超过 10 MB 的音频")
    data = {
        "model": model,
        "response_format": "verbose_json",
        "enable_speaker_diarization": "true",
        "enable_punctuation": "true",
        "timestamp_granularities[]": "segment",
    }
    if language != "auto":
        data["language"] = language
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0), transport=transport) as client:
        response = await client.post(
            f"{root_url(base_url)}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files={"file": (filename, source, mime_type)},
        )
    payload = response_json(response)
    text = payload.get("text")
    if not isinstance(text, str):
        raise SenseAudioProviderError("SenseAudio 语音识别响应缺少文本")
    return SenseAudioTranscription(text=text, segments=_normalize_segments(payload.get("segments")))
