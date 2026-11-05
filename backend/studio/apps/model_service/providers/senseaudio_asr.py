from __future__ import annotations

import math
from dataclasses import dataclass
from typing import BinaryIO
from urllib.parse import urlsplit, urlunsplit

import httpx

from studio.apps.model_service.providers._senseaudio import (
    SenseAudioProviderError,
    response_json,
    root_url,
)

MAX_ASR_FILE_BYTES = 10 * 1024 * 1024
MAX_PRO_ASR_FILE_BYTES = 100 * 1024 * 1024
PRO_ASR_PATH = "/api/v2/asr/pro"
PRO_ASR_LANGUAGES = {
    "en": "English",
    "ja": "Japanese",
    "jp": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "zh-cn": "Chinese",
    "zh-hans": "Chinese",
}


class SenseAudioAsrFileTooLarge(SenseAudioProviderError):
    pass


@dataclass(frozen=True)
class SenseAudioTranscriptSegment:
    speaker: str
    start_ms: int
    end_ms: int
    text: str
    translation: str | None = None
    speaker_candidates: tuple[str, ...] = ()
    is_overlap: bool = False


@dataclass(frozen=True)
class SenseAudioTranscriptWord:
    word: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class SenseAudioTranscription:
    text: str
    segments: tuple[SenseAudioTranscriptSegment, ...]
    words: tuple[SenseAudioTranscriptWord, ...] = ()
    detail: dict[str, object] | None = None


def _milliseconds(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        return None
    return round(numeric * 1000)


def _pro_milliseconds(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        return None
    return round(numeric)


def _pro_request_url(base_url: str) -> str:
    """Resolve the Pro ASR POST URL when kind is already known to be Pro."""
    raw = root_url(base_url)
    parsed = urlsplit(raw)
    path = parsed.path.rstrip("/")
    if path.endswith(PRO_ASR_PATH):
        return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
    return urlunsplit((parsed.scheme, parsed.netloc, PRO_ASR_PATH, "", ""))


def max_asr_file_bytes(*, pro: bool = False) -> int:
    return MAX_PRO_ASR_FILE_BYTES if pro else MAX_ASR_FILE_BYTES


def _pro_language(language: str) -> str:
    normalized = language.strip()
    if not normalized:
        return "auto"
    return PRO_ASR_LANGUAGES.get(normalized.lower(), normalized)


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
        translation = item.get("translation")
        segments.append(
            SenseAudioTranscriptSegment(
                speaker=speaker.strip()
                if isinstance(speaker, str) and speaker.strip()
                else "unknown",
                start_ms=start_ms,
                end_ms=end_ms,
                text=text.strip(),
                translation=(
                    translation.strip()
                    if isinstance(translation, str) and translation.strip()
                    else None
                ),
            )
        )
    return tuple(sorted(segments, key=lambda segment: (segment.start_ms, segment.end_ms)))


def _pro_speaker(item: dict[object, object]) -> str:
    speaker = item.get("speaker_id")
    if isinstance(speaker, str) and speaker.strip():
        return speaker.strip()
    candidates = item.get("speaker_ids")
    if isinstance(candidates, list):
        labels = [value.strip() for value in candidates if isinstance(value, str) and value.strip()]
        if labels:
            return "/".join(dict.fromkeys(labels))
    return "unknown"


def _pro_speaker_candidates(item: dict[object, object]) -> tuple[str, ...]:
    candidates = item.get("speaker_ids")
    if not isinstance(candidates, list):
        return ()
    return tuple(
        dict.fromkeys(
            value.strip() for value in candidates if isinstance(value, str) and value.strip()
        )
    )


def _normalize_words(value: object, *, milliseconds: bool) -> tuple[SenseAudioTranscriptWord, ...]:
    if not isinstance(value, list):
        return ()
    converted: list[SenseAudioTranscriptWord] = []
    convert = _pro_milliseconds if milliseconds else _milliseconds
    for item in value:
        if not isinstance(item, dict):
            continue
        word = item.get("word")
        start = convert(item.get("start_time") if milliseconds else item.get("start"))
        end = convert(item.get("end_time") if milliseconds else item.get("end"))
        if not isinstance(word, str) or not word or start is None or end is None or end < start:
            continue
        converted.append(SenseAudioTranscriptWord(word=word, start_ms=start, end_ms=end))
    return tuple(sorted(converted, key=lambda item: (item.start_ms, item.end_ms)))


def _normalize_pro_segments(value: object) -> tuple[SenseAudioTranscriptSegment, ...]:
    if not isinstance(value, list):
        return ()
    segments: list[SenseAudioTranscriptSegment] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        start_ms = _pro_milliseconds(item.get("start_time"))
        end_ms = _pro_milliseconds(item.get("end_time"))
        text = item.get("text")
        if (
            start_ms is None
            or end_ms is None
            or end_ms < start_ms
            or not isinstance(text, str)
            or not text.strip()
        ):
            continue
        segments.append(
            SenseAudioTranscriptSegment(
                speaker=_pro_speaker(item),
                start_ms=start_ms,
                end_ms=end_ms,
                text=text.strip(),
                translation=(
                    item["translation"].strip()
                    if isinstance(item.get("translation"), str) and item["translation"].strip()
                    else None
                ),
                speaker_candidates=_pro_speaker_candidates(item),
                is_overlap=item.get("is_overlap") is True,
            )
        )
    return tuple(sorted(segments, key=lambda segment: (segment.start_ms, segment.end_ms)))


def _status(value: object) -> str:
    return value if value in {"success", "degraded", "failed", "skipped", "unknown"} else "unknown"


def _audio_info(payload: dict[object, object]) -> dict[str, object] | None:
    value = payload.get("audio_info")
    if not isinstance(value, dict):
        return None
    duration = value.get("duration_ms", value.get("duration"))
    duration_ms = _pro_milliseconds(duration)
    audio_format = value.get("format")
    return {
        "duration_ms": duration_ms,
        "format": audio_format if isinstance(audio_format, str) else None,
    }


def _normalize_standard_detail(payload: dict[object, object]) -> dict[str, object]:
    audio_info = _audio_info(payload)
    if audio_info is None:
        duration_ms = _milliseconds(payload.get("duration"))
        if duration_ms is not None:
            audio_info = {"duration_ms": duration_ms, "format": None}
    return {
        "audio_info": audio_info,
        "processing_status": "success",
        "stages": [],
        "warnings": [],
        "overlap_intervals": [],
    }


def _normalize_pro_detail(payload: dict[object, object]) -> dict[str, object]:
    pipeline = payload.get("pipeline")
    stages: list[dict[str, str]] = []
    warnings: list[dict[str, object]] = []
    processing_status = "unknown"
    if isinstance(pipeline, dict):
        processing_status = _status(pipeline.get("status"))
        for name in ("asr", "alignment", "diarization", "text_transform"):
            stage = pipeline.get(name)
            if isinstance(stage, dict):
                stages.append({"name": name, "status": _status(stage.get("status"))})
        raw_warnings = pipeline.get("warnings")
        if isinstance(raw_warnings, list):
            for item in raw_warnings:
                if not isinstance(item, dict):
                    continue
                message = item.get("message")
                code = item.get("code")
                if not isinstance(message, str) or not isinstance(code, str):
                    continue
                stage = item.get("stage")
                warnings.append(
                    {
                        "stage": stage if isinstance(stage, str) else None,
                        "code": code,
                        "message": message,
                    }
                )
    overlap_intervals: list[dict[str, int]] = []
    diarization = payload.get("diarization")
    raw_intervals = diarization.get("overlap_intervals") if isinstance(diarization, dict) else None
    if isinstance(raw_intervals, list):
        for item in raw_intervals:
            if not isinstance(item, dict):
                continue
            start = _pro_milliseconds(item.get("start_time"))
            end = _pro_milliseconds(item.get("end_time"))
            if start is not None and end is not None and end >= start:
                overlap_intervals.append({"start_ms": start, "end_ms": end})
    return {
        "audio_info": _audio_info(payload),
        "processing_status": processing_status,
        "stages": stages,
        "warnings": warnings,
        "overlap_intervals": overlap_intervals,
    }


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
    target_language: str | None = None,
    enable_word_timestamps: bool = False,
    enable_text_edit: bool = True,
    enable_speaker_diarization: bool = True,
    max_speakers: int | None = None,
    enable_punctuation: bool = True,
    hotwords: str | None = None,
    abbreviations: bool = False,
    pro: bool = False,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SenseAudioTranscription:
    max_bytes = max_asr_file_bytes(pro=pro)
    if byte_size > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise SenseAudioAsrFileTooLarge(f"SenseAudio 语音识别仅支持不超过 {max_mb} MB 的音频")
    if pro:
        data = {
            "language": _pro_language(language),
            "enable_word_timestamps": str(enable_word_timestamps).lower(),
            "enable_text_edit": str(enable_text_edit).lower(),
            "enable_speaker_diarization": str(enable_speaker_diarization).lower(),
        }
        if target_language:
            data["target_lang"] = target_language
        endpoint = _pro_request_url(base_url)
    else:
        data = {
            "model": model,
            "response_format": "verbose_json",
            "stream": "false",
            "enable_speaker_diarization": str(enable_speaker_diarization).lower(),
            "enable_punctuation": str(enable_punctuation).lower(),
            "abbreviations": str(abbreviations).lower(),
            "timestamp_granularities[]": "segment",
        }
        if enable_word_timestamps:
            data["timestamp_granularities[]"] = ["segment", "word"]
        if language != "auto":
            data["language"] = language
        if target_language:
            data["target_language"] = target_language
        if max_speakers is not None:
            data["max_speakers"] = str(max_speakers)
        if hotwords:
            data["hotwords"] = hotwords
        endpoint = f"{root_url(base_url)}/audio/transcriptions"
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0), transport=transport) as client:
        response = await client.post(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files={"file": (filename, source, mime_type)},
        )
    payload = response_json(response)
    result = payload.get("result") if pro else payload
    if not isinstance(result, dict):
        raise SenseAudioProviderError("SenseAudio 语音识别响应缺少结果")
    text = result.get("text")
    if not isinstance(text, str):
        raise SenseAudioProviderError("SenseAudio 语音识别响应缺少文本")
    segments = (
        _normalize_pro_segments(result.get("utterances"))
        if pro
        else _normalize_segments(result.get("segments"))
    )
    if pro:
        utterances = result.get("utterances")
        words = tuple(
            word
            for item in (utterances if isinstance(utterances, list) else [])
            if isinstance(item, dict)
            for word in _normalize_words(item.get("words"), milliseconds=True)
        )
        detail = _normalize_pro_detail(payload)
    else:
        words = _normalize_words(payload.get("words"), milliseconds=False)
        detail = _normalize_standard_detail(payload)
    return SenseAudioTranscription(text=text, segments=segments, words=words, detail=detail)
