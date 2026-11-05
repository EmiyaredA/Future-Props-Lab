"""Catalog selection for Visual assistant conversations and generation models."""

from sqlalchemy import select

from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.chat_completions import TEXT_PROVIDER_KINDS
from studio.contracts.model_service.schemas.visual_catalog import (
    AssistantCatalog,
    VisualAssistantModelOptionOut,
)


def chat_ready(model, provider, *, require_vision=False):
    capabilities = model.capabilities or []
    return (
        model.enabled
        and provider.enabled
        and provider.kind in TEXT_PROVIDER_KINDS
        and "chat" in capabilities
        and (not require_vision or "vision" in capabilities)
    )


def generation_ready(model, provider, kind):
    return (
        model is not None
        and provider is not None
        and model.enabled
        and provider.enabled
        and provider.kind == f"senseaudio_{kind}"
        and f"{kind}_generation" in (model.capabilities or [])
    )


def chat_order(pair):
    return "tools" not in (pair[0].capabilities or [])


def model_option(model, provider):
    return VisualAssistantModelOptionOut(
        id=model.id,
        provider_id=provider.id,
        provider_name=provider.name,
        slug=model.slug,
        label=model.label or model.slug,
        description=model.description,
        capabilities=model.capabilities or [],
    )


async def catalog_rows(session):
    return (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .order_by(ModelProvider.sort_order, ModelEntry.sort_order, ModelEntry.slug)
        )
    ).all()


async def assistant_models(session):
    rows = await catalog_rows(session)
    chat = sorted(
        [(model, provider) for model, provider in rows if chat_ready(model, provider)],
        key=chat_order,
    )
    return AssistantCatalog(
        slugs={model.id: model.slug for model, _ in rows},
        image=[model.id for model, provider in rows if generation_ready(model, provider, "image")],
        video=[model.id for model, provider in rows if generation_ready(model, provider, "video")],
        options=[model_option(model, provider) for model, provider in chat],
    )
