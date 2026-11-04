"""Serve Visual's account-scoped catalog lookups without transferring credentials."""

from fastapi import APIRouter, Request

from app.llm.schemas.visual_catalog import AcceptanceModelListOut, GenerationOptionsOut
from app.llm.visual_catalog import acceptance_models, generation_options
from fpl_runtime.visual_catalog import ACCEPTANCE_TARGET, GENERATION_TARGET

from .catalog_reads import owned_catalog

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
