"""Credential-free readiness for a catalog speech recognition model."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.transcription import max_transcription_input_bytes
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


async def resolve_transcription_model_reference(
    session: AsyncSession, reference: object, owner_user_id: str
) -> str | None:
    if not isinstance(reference, dict):
        return None
    rows = (
        (
            await session.execute(
                select(ModelEntry.id)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelProvider.kind == str(reference.get("provider_kind") or ""),
                    ModelEntry.slug == str(reference.get("model_slug") or ""),
                    ModelEntry.enabled.is_(True),
                    ModelProvider.enabled.is_(True),
                    ModelEntry.owner_user_id == owner_user_id,
                    ModelProvider.owner_user_id == owner_user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    return rows[0] if len(rows) == 1 else None


async def transcription_model_snapshot(session, model_id):
    model = await session.get(ModelEntry, model_id)
    provider = await session.get(ModelProvider, model.provider_id) if model else None
    if model is None or not supports_asr(model, provider):
        return None
    return {
        "provider_id": provider.id,
        "provider_name": provider.name,
        "model_slug": model.slug,
        "byte_limit": max_transcription_input_bytes(provider),
    }
