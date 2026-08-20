from __future__ import annotations

import httpx

from app.llm.playground.transcription_parameters import parameter_capabilities
from app.llm.providers._senseaudio import SenseAudioProviderError
from app.llm.providers.senseaudio_asr import (
    MAX_ASR_FILE_BYTES,
    SenseAudioAsrFileTooLarge,
    max_asr_file_bytes,
)
from app.models import ModelEntry, ModelProvider

_LANGUAGE_ALIASES = {
    "zh": ("zh", "chinese"),
    "en": ("en", "english"),
    "ja": ("ja", "japanese"),
    "ko": ("ko", "korean"),
    "fr": ("fr", "french"),
    "de": ("de", "german"),
    "es": ("es", "spanish"),
    "pt": ("pt", "portuguese"),
}


def model_supports_transcription(model: ModelEntry, provider: ModelProvider | None) -> bool:
    declared = {
        *[str(value) for value in list(model.capabilities or [])],
        *[str(value) for value in list(model.categories or [])],
    }
    return bool(
        provider is not None
        and provider.kind in {"openai", "senseaudio_asr"}
        and provider.enabled
        and model.enabled
        and "speech_recognition" in declared
    )


def max_transcription_input_bytes(provider: ModelProvider) -> int:
    if provider.kind == "senseaudio_asr":
        return max_asr_file_bytes(provider.base_url)
    return MAX_ASR_FILE_BYTES


def resolve_transcription_language(
    model: ModelEntry,
    provider: ModelProvider,
    language_tag: str | None,
) -> str:
    options = parameter_capabilities(model, provider).language_options
    return _match_transcription_language(options, language_tag) or next(
        (option.value for option in options if option.value.casefold() == "auto"),
        "auto",
    )


def resolve_transcription_target_language(
    model: ModelEntry,
    provider: ModelProvider,
    language_tag: str | None,
) -> str | None:
    if not language_tag:
        return None
    return _match_transcription_language(
        parameter_capabilities(model, provider).target_language_options,
        language_tag,
    )


def _match_transcription_language(options, language_tag: str | None) -> str | None:
    values = {option.value.casefold(): option.value for option in options}
    normalized = (language_tag or "").strip().replace("_", "-").casefold()
    if not normalized:
        return None
    primary = normalized.split("-", 1)[0]
    candidates = (normalized, primary, *_LANGUAGE_ALIASES.get(primary, ()))
    for candidate in candidates:
        if resolved := values.get(candidate.casefold()):
            return resolved
    return None


def safe_transcription_error(exc: Exception) -> str:
    if isinstance(exc, SenseAudioAsrFileTooLarge):
        return str(exc)
    if isinstance(exc, httpx.TimeoutException):
        return "语音识别请求超时"
    if isinstance(exc, SenseAudioProviderError):
        return str(exc)[:4000]
    if isinstance(exc, httpx.HTTPStatusError):
        return f"语音识别供应商返回错误（HTTP {exc.response.status_code}）"
    if isinstance(exc, ValueError):
        return str(exc)[:4000]
    return f"语音识别失败（{type(exc).__name__}）"
