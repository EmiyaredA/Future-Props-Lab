from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.realtime.constants import (
    SENSEAUDIO_DEFAULT_VOICE,
    SENSEAUDIO_VOICE_PRESETS,
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
from app.llm.providers.realtime.contracts import ResolvedRealtimeModel
from app.llm.schemas.realtime_voice import (
    RealtimeNumberParameterOut,
    RealtimeVoiceMicrophoneOut,
    RealtimeVoiceModelOut,
    RealtimeVoiceOptionOut,
    RealtimeVoiceOptionsOut,
    RealtimeVoicePlaybackOut,
    RealtimeVoiceVadOut,
)
from app.runtime.credentials import decrypt_secret
from studio.runtime.database.ownership import bind_owner


class RealtimeModelUnavailableError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "voice_model_unavailable",
        retryable: bool = False,
        model: ResolvedRealtimeModel | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.model = model


def _number(
    default: float, minimum: float, maximum: float, step: float
) -> RealtimeNumberParameterOut:
    return RealtimeNumberParameterOut(
        default=default,
        minimum=minimum,
        maximum=maximum,
        step=step,
    )


async def list_realtime_models(session: AsyncSession) -> RealtimeVoiceOptionsOut:
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelProvider.kind == "senseaudio_realtime",
                ModelProvider.enabled.is_(True),
                ModelEntry.enabled.is_(True),
            )
            .order_by(ModelProvider.sort_order, ModelEntry.sort_order)
        )
    ).all()
    voices = [
        RealtimeVoiceOptionOut(value=value, label=label)
        for value, label in SENSEAUDIO_VOICE_PRESETS
    ]
    return RealtimeVoiceOptionsOut(
        models=[
            RealtimeVoiceModelOut(
                id=model.id,
                provider_id=provider.id,
                provider_name=provider.name,
                provider_kind=provider.kind,
                slug=model.slug,
                label=model.label or model.slug,
                voices=voices,
                default_voice=SENSEAUDIO_DEFAULT_VOICE,
                input_sample_rate=VOICE_INPUT_SAMPLE_RATE,
                output_sample_rate=VOICE_OUTPUT_SAMPLE_RATE,
                commit_silence_ms=VOICE_COMMIT_SILENCE_MS,
                supports_interruption=True,
                instructions_max_chars=VOICE_INSTRUCTIONS_MAX_CHARS,
                greeting_max_chars=VOICE_GREETING_MAX_CHARS,
                input_format="pcm_s16le",
                output_format="pcm_s16le",
                channels=1,
                client_vad=RealtimeVoiceVadOut(
                    positive_speech_threshold=_number(VOICE_VAD_POSITIVE_THRESHOLD, 0.05, 1, 0.01),
                    negative_speech_threshold=_number(VOICE_VAD_NEGATIVE_THRESHOLD, 0, 0.95, 0.01),
                    min_speech_ms=_number(VOICE_VAD_MIN_SPEECH_MS, 64, 5_000, 32),
                    pre_speech_pad_ms=_number(VOICE_VAD_PRE_SPEECH_PAD_MS, 0, 2_000, 32),
                    commit_silence_ms=_number(VOICE_COMMIT_SILENCE_MS, 100, 5_000, 50),
                ),
                playback=RealtimeVoicePlaybackOut(
                    start_buffer_ms=_number(VOICE_PLAYBACK_START_BUFFER_MS, 0, 2_000, 50),
                    recovery_buffer_ms=_number(VOICE_PLAYBACK_RECOVERY_BUFFER_MS, 0, 3_000, 50),
                ),
                microphone=RealtimeVoiceMicrophoneOut(
                    echo_cancellation=True,
                    noise_suppression=True,
                    auto_gain_control=True,
                ),
            )
            for model, provider in rows
            if "voice" in list(model.capabilities or [])
        ]
    )


async def resolve_realtime_model(
    session: AsyncSession, *, owner_user_id: str, model_id: str
) -> ResolvedRealtimeModel:
    bind_owner(session, owner_user_id)
    row = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(ModelEntry.id == model_id)
        )
    ).one_or_none()
    if row is None:
        raise RealtimeModelUnavailableError("实时语音模型不存在")
    model, provider = row
    if (
        not model.enabled
        or not provider.enabled
        or provider.kind != "senseaudio_realtime"
        or "voice" not in list(model.capabilities or [])
    ):
        raise RealtimeModelUnavailableError("实时语音模型未启用")
    try:
        api_key = decrypt_secret(provider.api_key_ciphertext) if provider.api_key_ciphertext else ""
    except Exception as exc:
        raise RealtimeModelUnavailableError(
            "实时语音供应商密钥无法读取",
            code="voice_key_unreadable",
        ) from exc
    resolved = ResolvedRealtimeModel(
        id=model.id,
        provider_id=provider.id,
        provider_name=provider.name,
        provider_kind=provider.kind,
        slug=model.slug,
        label=model.label or model.slug,
        base_url=provider.base_url,
        api_key=api_key,
    )
    if not api_key:
        raise RealtimeModelUnavailableError(
            "请先为实时语音供应商配置 API Key",
            code="voice_key_missing",
            model=resolved,
        )
    return resolved
