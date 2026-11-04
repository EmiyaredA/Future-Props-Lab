"""Resolve ASR model readiness from the requesting account's Models catalog."""

from fastapi import APIRouter, HTTPException, Request

from app.llm.transcription_catalog import (
    resolve_transcription_model_reference,
    transcription_model_ready,
    transcription_model_reference,
)
from fpl_runtime.galgame_asr import PREFIX, AsrModelStatus, asr_model_target
from fpl_runtime.galgame_snapshot import (
    MODEL_REFERENCE_PREFIX,
    MODEL_RESOLVE_PREFIX,
    ModelReference,
    model_reference_target,
    model_resolution_target,
)

from .catalog_reads import owned_catalog

router = APIRouter(include_in_schema=False)


@router.get(PREFIX + "/{model_id}", response_model=AsrModelStatus)
async def galgame_asr_model_status(request: Request, model_id: str):
    if not asr_model_target("GET", request.url.path):
        raise HTTPException(404, "galgame_asr_model_not_found")
    async with owned_catalog(request, purpose="galgame_asr") as (_actor, session):
        return AsrModelStatus(ready=await transcription_model_ready(session, model_id))


@router.get(MODEL_REFERENCE_PREFIX + "/{model_id}", response_model=ModelReference | None)
async def galgame_snapshot_model_reference(request: Request, model_id: str):
    if not model_reference_target("GET", request.url.path):
        raise HTTPException(404, "galgame_snapshot_model_not_found")
    async with owned_catalog(request, purpose="galgame_snapshot_model") as (actor, session):
        return await transcription_model_reference(session, model_id, actor.user_id)


@router.post(MODEL_RESOLVE_PREFIX + "/{digest}", response_model=str | None)
async def resolve_galgame_snapshot_model(request: Request, body: ModelReference, digest: str):
    if not model_resolution_target("POST", request.url.path) or body.digest != digest:
        raise HTTPException(403, "galgame_snapshot_model_grant_required")
    async with owned_catalog(request, purpose="galgame_snapshot_model") as (actor, session):
        return await resolve_transcription_model_reference(
            session, body.model_dump(), actor.user_id
        )
