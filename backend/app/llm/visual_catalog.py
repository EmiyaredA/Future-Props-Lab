"""Select the account model catalog entries offered in Visual."""

from sqlalchemy import select

from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers import autodl_workflows
from app.llm.providers.chat_completions import TEXT_PROVIDER_KINDS
from app.llm.providers.seedance_parameters import video_capabilities
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.llm.providers.volcengine_image import SEEDREAM_SIZES
from app.llm.providers.zealman_workflows import WORKFLOWS, parameter_options
from app.llm.schemas.visual_catalog import (
    AcceptanceModelListOut,
    AcceptanceModelOut,
    GenerationModelOptionOut,
    GenerationOptionsOut,
)


async def generation_options(session, *, upload_configured) -> GenerationOptionsOut:
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelProvider.enabled.is_(True),
                ModelEntry.enabled.is_(True),
                ModelProvider.kind.in_(
                    (
                        "senseaudio_image",
                        "volcengine_image",
                        "senseaudio_video",
                        "volcengine_video",
                        "zealman_video",
                        "autodl_video",
                        "senseaudio_music",
                        "senseaudio_sfx",
                    )
                ),
            )
            .order_by(ModelProvider.sort_order, ModelEntry.sort_order)
        )
    ).all()
    return GenerationOptionsOut(
        models=[
            GenerationModelOptionOut(
                id=model.id,
                provider_id=provider.id,
                provider_name=provider.name,
                kind=(
                    "image"
                    if provider.kind in {"senseaudio_image", "volcengine_image"}
                    else "video"
                    if provider.kind
                    in {"senseaudio_video", "zealman_video", "volcengine_video", "autodl_video"}
                    else "audio"
                ),
                slug=model.slug,
                label=model.label or model.slug,
                description=model.description,
                sizes=list(
                    SEEDREAM_SIZES
                    if provider.kind == "volcengine_image"
                    else IMAGE_MODEL_SIZES.get(model.slug, ())
                ),
                max_reference_images=14
                if provider.kind == "volcengine_image"
                else 30
                if provider.kind == "volcengine_video"
                and model.slug == "doubao-seedance-2-5-260628"
                else 9
                if provider.kind in {"zealman_video", "volcengine_video", "autodl_video"}
                else 1,
                supports_seed=provider.kind not in {"volcengine_image", "volcengine_video"},
                max_prompt_length=20000
                if provider.kind == "autodl_video"
                else 6000
                if provider.kind in {"zealman_video", "autodl_video"}
                or model.slug == "senseaudio-image-2.0-260319"
                else 2000,
                video_capabilities=video_capabilities(
                    provider.kind,
                    model.slug,
                    upload_configured=upload_configured,
                ),
                workflow_capabilities=(
                    parameter_options(model.slug) if provider.kind == "zealman_video" else None
                ),
            )
            for model, provider in rows
            if (provider.kind != "zealman_video" or model.slug in WORKFLOWS)
            and (provider.kind != "autodl_video" or model.slug in autodl_workflows.WORKFLOWS)
            and (
                provider.kind != "volcengine_video"
                or model.slug in {"doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"}
            )
        ]
    )


async def review_models(session, owner_user_id, *, model_id=None):
    selection = () if model_id is None else (ModelEntry.id == model_id,)
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
                *selection,
            )
        )
    ).all()
    return [
        (model, provider)
        for model, provider in rows
        if {"chat", "vision"} <= set(model.capabilities or [])
        and bool(provider.api_key_ciphertext or provider.base_url)
    ]


async def acceptance_models(session, owner_user_id) -> AcceptanceModelListOut:
    return AcceptanceModelListOut(
        items=[
            acceptance_model_out(model, provider)
            for model, provider in await review_models(session, owner_user_id)
        ]
    )


async def fixed_acceptance_model(session, owner_user_id, settings):
    if (
        settings.fpl_acceptance_model_owner_user_id != owner_user_id
        or not settings.fpl_acceptance_model_id
    ):
        return None
    rows = await review_models(session, owner_user_id, model_id=settings.fpl_acceptance_model_id)
    return next(iter(rows), None)


def acceptance_model_out(model, provider):
    return AcceptanceModelOut(
        id=model.id,
        label=model.label or model.slug,
        slug=model.slug,
        provider_name=provider.name,
        provider_kind=provider.kind,
    )
