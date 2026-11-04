"""Credential-free readiness for a catalog speech recognition model."""

from app.llm.models import ModelEntry, ModelProvider


def supports_asr(model: ModelEntry, provider: ModelProvider | None) -> bool:
    return bool(
        provider is not None
        and provider.kind in {"openai", "senseaudio_asr", "senseaudio_asr_pro"}
        and provider.enabled
        and model.enabled
        and (
            "speech_recognition" in list(model.capabilities or [])
            or "speech_recognition" in list(model.categories or [])
        )
    )


async def transcription_model_ready(session, model_id):
    model = await session.get(ModelEntry, model_id)
    provider = await session.get(ModelProvider, model.provider_id) if model else None
    return bool(model and supports_asr(model, provider))


async def transcription_model_reference(session, model_id, owner):
    if not model_id:
        return None
    model = await session.get(ModelEntry, model_id)
    if model is None or model.owner_user_id != owner:
        return None
    provider = await session.get(ModelProvider, model.provider_id)
    if provider is None or provider.owner_user_id != owner:
        return None
    return {"provider_kind": provider.kind, "model_slug": model.slug}
