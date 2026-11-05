"""Serve Visual's account-scoped catalog lookups without transferring credentials."""

from fastapi import APIRouter, HTTPException, Request

from app.llm.assistant_catalog import assistant_models
from app.llm.schemas.visual_catalog import (
    AcceptanceModelListOut,
    AssistantCatalog,
    FixedAcceptanceModelOut,
    GenerationOptionsOut,
)
from app.llm.visual_catalog import (
    acceptance_model_out,
    acceptance_models,
    fixed_acceptance_model,
    generation_options,
    resolve_snapshot_models,
    snapshot_model_labels,
)
from studio.apps.model_service.catalog_reads import owned_catalog
from studio.contracts.visual_workshop.visual_assistant import MODEL_TARGET
from studio.contracts.visual_workshop.visual_catalog import (
    ACCEPTANCE_TARGET,
    FIXED_ACCEPTANCE_TARGET,
    GENERATION_TARGET,
)
from studio.contracts.visual_workshop.visual_snapshot import (
    MODEL_RESOLVE,
    MODELS,
    ModelIdentity,
    SnapshotModelResolution,
    SnapshotModels,
)

router = APIRouter(include_in_schema=False)


@router.get(GENERATION_TARGET, response_model=GenerationOptionsOut)
async def read_generation_options(request: Request):
    async with owned_catalog(request, purpose="visual_catalog") as (_actor, session):
        return await generation_options(
            session, upload_configured=bool(request.app.state.settings.fpl_temp_media_upload_url)
        )


@router.get(ACCEPTANCE_TARGET, response_model=AcceptanceModelListOut)
async def read_acceptance_models(request: Request):
    async with owned_catalog(request, purpose="visual_catalog") as (actor, session):
        return await acceptance_models(session, actor.user_id)


@router.get(MODEL_TARGET, response_model=AssistantCatalog)
async def read_assistant_models(request: Request):
    async with owned_catalog(request, purpose="visual_assistant") as (_actor, session):
        return await assistant_models(session)


@router.get(FIXED_ACCEPTANCE_TARGET, response_model=FixedAcceptanceModelOut)
async def read_fixed_acceptance_model(request: Request):
    async with owned_catalog(request, purpose="visual_fixed_acceptance") as (actor, session):
        pair = await fixed_acceptance_model(session, actor.user_id, request.app.state.settings)
        return FixedAcceptanceModelOut(
            model=acceptance_model_out(*pair) if pair is not None else None
        )


@router.post(MODELS + "/{digest}", response_model=dict[str, ModelIdentity])
async def read_snapshot_model_labels(request: Request, digest: str, body: SnapshotModels):
    if body.digest != digest:
        raise HTTPException(403, "visual_snapshot_model_query_changed")
    async with owned_catalog(request, purpose="visual_snapshot_models") as (actor, session):
        return await snapshot_model_labels(session, actor.user_id, body.model_ids)


@router.post(MODEL_RESOLVE + "/{digest}", response_model=dict[str, str])
async def resolve_snapshot_model_labels(
    request: Request, digest: str, body: SnapshotModelResolution
):
    if body.digest != digest:
        raise HTTPException(403, "visual_snapshot_model_query_changed")
    async with owned_catalog(
        request, purpose="visual_snapshot_models", permission="content.write"
    ) as (actor, session):
        return await resolve_snapshot_models(
            session,
            {key: value.model_dump() for key, value in body.references.items()},
            actor.user_id,
        )
