"""Publish only account-bound Visual model choices, with credentials staying in Models."""

from fastapi import APIRouter, HTTPException, Request

from app.llm.visual_generation_model import VisualGenerationValidationError, select_visual_model
from fpl_runtime.visual_generation import MODEL, ModelSelection, VisualModelChoice

from .catalog_reads import owned_catalog

router = APIRouter(include_in_schema=False)


@router.post(MODEL + "/{digest}", response_model=VisualModelChoice)
async def choose_visual_model(request: Request, digest: str, body: ModelSelection):
    if body.digest != digest:
        raise HTTPException(403, "visual_generation_model_query_changed")
    async with owned_catalog(
        request, purpose="visual_generation_model", permission="models.use"
    ) as (
        actor,
        session,
    ):
        try:
            model, provider = await select_visual_model(
                session, actor.user_id, body.model_id, body.kind, body.audio_mode
            )
        except VisualGenerationValidationError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
        return VisualModelChoice(
            model_id=model.id,
            provider_id=provider.id,
            provider_kind=provider.kind,
            provider_name=provider.name,
            model_slug=model.slug,
            temporary_upload_configured=bool(request.app.state.settings.fpl_temp_media_upload_url),
        )
