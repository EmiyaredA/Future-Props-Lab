from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO

import httpx

from studio.apps.model_service.providers.senseaudio_asr import MAX_ASR_FILE_BYTES, transcribe_audio
from studio.runtime.http.outbound_urls import require_safe_provider_base_url

SENSEAUDIO_ASR_KINDS = frozenset({"senseaudio_asr", "senseaudio_asr_pro"})


@dataclass(frozen=True)
class TranscriptSegment:
    speaker: str
    start_ms: int
    end_ms: int
    text: str
    translation: str | None = None
    speaker_candidates: tuple[str, ...] = ()
    is_overlap: bool = False


@dataclass(frozen=True)
class TranscriptWord:
    word: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    segments: tuple[TranscriptSegment, ...] = ()
    words: tuple[TranscriptWord, ...] = ()
    detail: dict[str, object] | None = None


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
    parameters: dict[str, object] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> TranscriptionResult:
    """Normalize supported ASR providers to text plus optional diarized segments."""
    base_url = require_safe_provider_base_url(base_url)
    options = parameters or {}
    if provider_kind in SENSEAUDIO_ASR_KINDS:
        result = await transcribe_audio(
            base_url=base_url,
            api_key=api_key,
            model=model,
            filename=filename,
            source=source,
            mime_type=mime_type,
            byte_size=byte_size,
            language=language,
            target_language=options.get("target_language") or None,
            enable_word_timestamps=options.get("enable_word_timestamps") is True,
            enable_text_edit=options.get("enable_text_edit") is True,
            enable_speaker_diarization=options.get("enable_speaker_diarization") is True,
            max_speakers=(
                int(options["max_speakers"])
                if isinstance(options.get("max_speakers"), int)
                else None
            ),
            enable_punctuation=options.get("enable_punctuation") is True,
            hotwords=(
                str(options["hotwords"]) if isinstance(options.get("hotwords"), str) else None
            ),
            abbreviations=options.get("abbreviations") is True,
            pro=provider_kind == "senseaudio_asr_pro",
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
                    translation=item.translation,
                    speaker_candidates=item.speaker_candidates,
                    is_overlap=item.is_overlap,
                )
                for item in result.segments
            ),
            words=tuple(
                TranscriptWord(word=item.word, start_ms=item.start_ms, end_ms=item.end_ms)
                for item in result.words
            ),
            detail=result.detail,
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
