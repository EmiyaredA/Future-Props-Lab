from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO

import httpx

from app.llm.providers.senseaudio_asr import MAX_ASR_FILE_BYTES, transcribe_audio


@dataclass(frozen=True)
class TranscriptSegment:
    speaker: str
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    segments: tuple[TranscriptSegment, ...] = ()


async def transcribe_model_audio(
    *,
    provider_kind: str,
    base_url: str,
    api_key: str,
    model: str,
    filename: str,
    source: BinaryIO,
    mime_type: str,
    byte_size: int,
    language: str = "auto",
    transport: httpx.AsyncBaseTransport | None = None,
) -> TranscriptionResult:
    """Normalize supported ASR providers to text plus optional diarized segments."""
    if provider_kind == "senseaudio_asr":
        result = await transcribe_audio(
            base_url=base_url,
            api_key=api_key,
            model=model,
            filename=filename,
            source=source,
            mime_type=mime_type,
            byte_size=byte_size,
            language=language,
            transport=transport,
        )
        return TranscriptionResult(
            text=result.text,
            segments=tuple(
                TranscriptSegment(
                    speaker=item.speaker,
                    start_ms=item.start_ms,
                    end_ms=item.end_ms,
                    text=item.text,
                )
                for item in result.segments
            ),
        )
    if provider_kind != "openai":
        raise ValueError("当前供应商不支持语音识别")
    if byte_size > MAX_ASR_FILE_BYTES:
        raise ValueError("语音识别仅支持不超过 10 MB 的音频")
    data = {"model": model, "response_format": "json"}
    if language != "auto":
        data["language"] = language
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0), transport=transport) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files={"file": (filename, source, mime_type)},
        )
        response.raise_for_status()
        payload = response.json()
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str):
        raise ValueError("语音识别响应缺少文本")
    return TranscriptionResult(text=text)
