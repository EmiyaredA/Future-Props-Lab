"""Resolve ASR model readiness from the requesting account's Models catalog."""

from fastapi import APIRouter, HTTPException, Request

from app.llm.transcription_catalog import transcription_model_ready
from fpl_runtime.galgame_asr import PREFIX, AsrModelStatus, asr_model_target

from .catalog_reads import owned_catalog

router = APIRouter(include_in_schema=False)


@router.get(PREFIX + "/{model_id}", response_model=AsrModelStatus)
async def galgame_asr_model_status(request: Request, model_id: str):
    if not asr_model_target("GET", request.url.path):
        raise HTTPException(404, "galgame_asr_model_not_found")
    async with owned_catalog(request, purpose="galgame_asr") as (_actor, session):
        return AsrModelStatus(ready=await transcription_model_ready(session, model_id))
