from __future__ import annotations

from dataclasses import dataclass

from app.capabilities.transcription.catalog_values import TranscriptionModel, TranscriptionProvider
from app.capabilities.transcription.schemas import (
    ModelTestTranscriptionLanguageOptionOut,
    ModelTestTranscriptionParameterCapabilitiesOut,
    ModelTestTranscriptionParametersIn,
    ModelTestTranscriptionParametersOut,
)

OFFICIAL_LANGUAGES = (
    ("auto", "自动识别"),
    ("zh", "中文"),
    ("en", "English"),
    ("ja", "日本語"),
    ("ko", "한국어"),
    ("yue", "粤语"),
    ("ar", "阿拉伯语"),
    ("nl", "荷兰语"),
    ("fr", "Français"),
    ("de", "Deutsch"),
    ("id", "印尼语"),
    ("it", "Italiano"),
    ("ms", "马来语"),
    ("pt", "Português"),
    ("ru", "Русский"),
    ("es", "Español"),
    ("th", "ไทย"),
    ("tr", "Türkçe"),
    ("ur", "乌尔都语"),
    ("vi", "Tiếng Việt"),
)
PRO_LANGUAGES = (
    ("auto", "自动识别"),
    ("Chinese", "简体中文"),
    ("English", "English"),
    ("Japanese", "日本語"),
    ("Korean", "한국어"),
    ("French", "Français"),
    ("German", "Deutsch"),
    ("Spanish", "Español"),
    ("Portuguese", "Português"),
)
OPENAI_LANGUAGES = OFFICIAL_LANGUAGES[:5]


class TranscriptionParameterError(ValueError):
    pass


@dataclass(frozen=True)
class ParameterSupport:
    custom_pro: bool = False
    word_timestamps: bool = False
    text_edit: bool = False
    speaker_diarization: bool = False
    max_speakers: bool = False
    punctuation: bool = False
    hotwords: bool = False
    abbreviations: bool = False
    target_language: bool = False


def parameter_support(
    model: TranscriptionModel, provider: TranscriptionProvider
) -> ParameterSupport:
    if provider.kind == "openai":
        return ParameterSupport()
    if provider.kind == "senseaudio_asr_pro":
        return ParameterSupport(
            custom_pro=True,
            word_timestamps=True,
            text_edit=True,
            speaker_diarization=True,
            target_language=True,
        )
    slug = model.slug.lower()
    if "deepthink" in slug:
        return ParameterSupport(target_language=True, abbreviations=True)
    if "lite" in slug:
        return ParameterSupport(hotwords=True, abbreviations=True)
    is_pro = "asr-pro" in slug
    return ParameterSupport(
        word_timestamps=True,
        speaker_diarization=True,
        max_speakers=is_pro,
        punctuation=True,
        abbreviations=True,
        target_language=is_pro,
    )


def _language_options(support: ParameterSupport, provider_kind: str):
    values = (
        PRO_LANGUAGES
        if support.custom_pro
        else (OPENAI_LANGUAGES if provider_kind == "openai" else OFFICIAL_LANGUAGES)
    )
    return [
        ModelTestTranscriptionLanguageOptionOut(value=value, label=label) for value, label in values
    ]


def default_parameters(support: ParameterSupport) -> ModelTestTranscriptionParametersOut:
    return ModelTestTranscriptionParametersOut(
        language="auto",
        target_language=None,
        enable_word_timestamps=False,
        enable_text_edit=support.text_edit,
        enable_speaker_diarization=support.speaker_diarization,
        max_speakers=None,
        enable_punctuation=support.punctuation,
        hotwords=None,
        abbreviations=False,
    )


def parameter_capabilities(
    model: TranscriptionModel, provider: TranscriptionProvider
) -> ModelTestTranscriptionParameterCapabilitiesOut:
    support = parameter_support(model, provider)
    return ModelTestTranscriptionParameterCapabilitiesOut(
        language_mode="candidates" if support.custom_pro else "select",
        language_options=_language_options(support, provider.kind),
        target_language_options=(
            _language_options(support, provider.kind)[1:] if support.target_language else []
        ),
        supports_word_timestamps=support.word_timestamps,
        supports_text_edit=support.text_edit,
        supports_speaker_diarization=support.speaker_diarization,
        supports_max_speakers=support.max_speakers,
        supports_punctuation=support.punctuation,
        supports_hotwords=support.hotwords,
        supports_abbreviations=support.abbreviations,
        defaults=default_parameters(support),
    )


def _optional_flag(value: bool | None, *, supported: bool, name: str, default: bool) -> bool:
    if value is True and not supported:
        raise TranscriptionParameterError(f"当前模型不支持参数 {name}")
    return default if value is None else value


def resolve_parameters(
    body: ModelTestTranscriptionParametersIn,
    model: TranscriptionModel,
    provider: TranscriptionProvider,
) -> ModelTestTranscriptionParametersOut:
    support = parameter_support(model, provider)
    defaults = default_parameters(support)
    language = (body.language or defaults.language).strip()
    if support.custom_pro:
        candidates = [item.strip() for item in language.split(",")]
        if not candidates or any(not item for item in candidates) or len(candidates) > 8:
            raise TranscriptionParameterError("识别语言最多支持 8 个非空候选")
        if any(item.casefold() == "auto" for item in candidates) and len(candidates) != 1:
            raise TranscriptionParameterError("auto 只能单独作为识别语言")
        known = {value.casefold(): value for value, _label in PRO_LANGUAGES}
        if any(item.casefold() not in known for item in candidates):
            raise TranscriptionParameterError("当前 Pro 端点不支持所填识别语言候选")
        language = ",".join(known[item.casefold()] for item in candidates)
    else:
        allowed = {
            value
            for value, _label in (
                OPENAI_LANGUAGES if provider.kind == "openai" else OFFICIAL_LANGUAGES
            )
        }
        if language not in allowed:
            raise TranscriptionParameterError("当前模型不支持所选识别语言")

    target = (body.target_language or "").strip() or None
    if target and not support.target_language:
        raise TranscriptionParameterError("当前模型不支持目标翻译语言")
    if target:
        allowed_targets = {
            value.casefold(): value
            for value, _label in (
                PRO_LANGUAGES[1:] if support.custom_pro else OFFICIAL_LANGUAGES[1:]
            )
        }
        normalized_target = allowed_targets.get(target.casefold())
        if normalized_target is None:
            raise TranscriptionParameterError("当前模型不支持所选目标翻译语言")
        target = normalized_target

    speaker = _optional_flag(
        body.enable_speaker_diarization,
        supported=support.speaker_diarization,
        name="enable_speaker_diarization",
        default=defaults.enable_speaker_diarization,
    )
    if body.max_speakers is not None and not support.max_speakers:
        raise TranscriptionParameterError("当前模型不支持参数 max_speakers")
    if body.max_speakers is not None and not speaker:
        raise TranscriptionParameterError("设置最大说话人数前必须开启说话人识别")
    hotwords = (body.hotwords or "").strip() or None
    if hotwords and not support.hotwords:
        raise TranscriptionParameterError("当前模型不支持参数 hotwords")
    if hotwords:
        words = [item.strip() for item in hotwords.split(",")]
        if any(not item for item in words) or len(words) > 50:
            raise TranscriptionParameterError("热词必须用英文逗号分隔且不能超过 50 个")
        hotwords = ",".join(words)

    return ModelTestTranscriptionParametersOut(
        language=language,
        target_language=target,
        enable_word_timestamps=_optional_flag(
            body.enable_word_timestamps,
            supported=support.word_timestamps,
            name="enable_word_timestamps",
            default=defaults.enable_word_timestamps,
        ),
        enable_text_edit=_optional_flag(
            body.enable_text_edit,
            supported=support.text_edit,
            name="enable_text_edit",
            default=defaults.enable_text_edit,
        ),
        enable_speaker_diarization=speaker,
        max_speakers=body.max_speakers,
        enable_punctuation=_optional_flag(
            body.enable_punctuation,
            supported=support.punctuation,
            name="enable_punctuation",
            default=defaults.enable_punctuation,
        ),
        hotwords=hotwords,
        abbreviations=_optional_flag(
            body.abbreviations,
            supported=support.abbreviations,
            name="abbreviations",
            default=defaults.abbreviations,
        ),
    )
