from sqlalchemy import select

from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.chat_completions import TEXT_PROVIDER_KINDS


async def review_models(session, owner_user_id):
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelEntry.owner_user_id == owner_user_id,
                ModelProvider.owner_user_id == owner_user_id,
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
                ModelProvider.kind.in_(TEXT_PROVIDER_KINDS),
            )
        )
    ).all()
    return [
        (model, provider)
        for model, provider in rows
        if {"chat", "vision"} <= set(model.capabilities or [])
        and bool(provider.api_key_ciphertext or provider.base_url)
    ]
