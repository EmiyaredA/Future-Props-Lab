"""Detached writing selections and account-owned call-log persistence."""

from dataclasses import dataclass

from sqlalchemy import select

from studio.apps.model_service.providers.chat_completions import TEXT_PROVIDER_KINDS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.runtime.database.ownership import bind_owner


@dataclass(frozen=True)
class WritingModel:
    id: str
    label: str
    slug: str


@dataclass(frozen=True)
class WritingProvider:
    kind: str
    base_url: str
    api_key_ciphertext: str


async def selections(session, owner):
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelEntry.owner_user_id == owner,
                ModelProvider.owner_user_id == owner,
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
            )
        )
    ).all()
    return [
        (
            WritingModel(model.id, model.label, model.slug),
            WritingProvider(provider.kind, provider.base_url, provider.api_key_ciphertext),
        )
        for model, provider in rows
        if "chat" in model.capabilities and provider.kind in TEXT_PROVIDER_KINDS
    ]


async def record_call(sessions, values):
    owner = values["owner_user_id"]
    async with sessions(info={"owner_user_id": owner}) as session:
        bind_owner(session, owner)
        session.add(LlmCallLog(**values))
        await session.commit()
