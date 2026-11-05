from __future__ import annotations

import httpx

from studio.apps.model_service.transcription.catalog_values import (
    TranscriptionModel,
    TranscriptionProvider,
)
from studio.apps.model_service.transcription.parameters import parameter_capabilities

# Keep SenseAudio limits local so capabilities/transcription does not import llm.
MAX_ASR_FILE_BYTES = 10 * 1024 * 1024
MAX_PRO_ASR_FILE_BYTES = 100 * 1024 * 1024
SENSEAUDIO_ASR_KINDS = frozenset({"senseaudio_asr", "senseaudio_asr_pro"})


def _max_asr_file_bytes(*, pro: bool = False) -> int:
    return MAX_PRO_ASR_FILE_BYTES if pro else MAX_ASR_FILE_BYTES


def _is_senseaudio_error(exc: Exception, *, name: str) -> bool:
    return any(base.__name__ == name for base in type(exc).mro())


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


def model_supports_transcription(
    model: TranscriptionModel, provider: TranscriptionProvider | None
) -> bool:
    declared = {
        *[str(value) for value in list(model.capabilities or [])],
        *[str(value) for value in list(model.categories or [])],
    }
    return bool(
        provider is not None
        and provider.kind in {"openai", *SENSEAUDIO_ASR_KINDS}
        and provider.enabled
        and model.enabled
        and "speech_recognition" in declared
    )


def max_transcription_input_bytes(provider: TranscriptionProvider) -> int:
    if provider.kind in SENSEAUDIO_ASR_KINDS:
        return _max_asr_file_bytes(pro=provider.kind == "senseaudio_asr_pro")
    return MAX_ASR_FILE_BYTES


def resolve_transcription_language(
    model: TranscriptionModel,
    provider: TranscriptionProvider,
    language_tag: str | None,
) -> str:
    options = parameter_capabilities(model, provider).language_options
    return _match_transcription_language(options, language_tag) or next(
        (option.value for option in options if option.value.casefold() == "auto"),
        "auto",
    )


def resolve_transcription_target_language(
    model: TranscriptionModel,
    provider: TranscriptionProvider,
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
    if _is_senseaudio_error(exc, name="SenseAudioAsrFileTooLarge"):
        return str(exc)
    if isinstance(exc, httpx.TimeoutException):
        return "语音识别请求超时"
    if _is_senseaudio_error(exc, name="SenseAudioProviderError"):
        return str(exc)[:4000]
    if isinstance(exc, httpx.HTTPStatusError):
        return f"语音识别供应商返回错误（HTTP {exc.response.status_code}）"
    if isinstance(exc, ValueError):
        return str(exc)[:4000]
    return f"语音识别失败（{type(exc).__name__}）"
