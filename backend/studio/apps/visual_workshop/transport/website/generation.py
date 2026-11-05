from __future__ import annotations

from fastapi import APIRouter, Request

from app.llm.routes.model_capacity import task_admission
from app.llm.schemas.visual_catalog import GenerationOptionsOut
from studio.apps.visual_workshop.generation_common import GenerationError
from studio.apps.visual_workshop.generation_routes import generation_error
from studio.apps.visual_workshop.schemas.generation import (
    GenerationBatchOut,
    ImageCompositionCreateIn,
    ImageGenerationBatchCreateIn,
)
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskCreateIn, GenerationTaskOut
from studio.apps.visual_workshop.website.generation import VisualGeneration
from studio.assembly.http_dependencies import SessionDep

router = APIRouter(prefix="/visual-workshop", tags=["visual-generation"])


@router.get("/generation-options", response_model=GenerationOptionsOut)
async def generation_options(session: SessionDep) -> GenerationOptionsOut:
    return await VisualGeneration(session).options()


@router.post(
    "/projects/{project_id}/generation-tasks",
    response_model=GenerationTaskOut,
)
async def create_generation_task(
    request: Request,
    session: SessionDep,
    project_id: str,
    body: GenerationTaskCreateIn,
) -> GenerationTaskOut:
    try:
        result = await VisualGeneration(session).create(
            project_id, body, admission=task_admission(request, session, "visual")
        )
        return result
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post(
    "/projects/{project_id}/generation-batches",
    response_model=GenerationBatchOut,
)
async def create_generation_batch(
    request: Request,
    session: SessionDep,
    project_id: str,
    body: ImageGenerationBatchCreateIn,
) -> GenerationBatchOut:
    try:
        result = await VisualGeneration(session).create_batch(
            project_id, body, admission=task_admission(request, session, "visual")
        )
        return result
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post(
    "/projects/{project_id}/image-compositions",
    response_model=GenerationBatchOut,
)
async def create_image_composition(
    session: SessionDep,
    project_id: str,
    body: ImageCompositionCreateIn,
) -> GenerationBatchOut:
    try:
        return await VisualGeneration(session).create_composition(project_id, body)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post(
    "/generation-batches/{batch_id}/retry-composition",
    response_model=GenerationBatchOut,
)
async def retry_image_composition(session: SessionDep, batch_id: str) -> GenerationBatchOut:
    try:
        return await VisualGeneration(session).retry_composition(batch_id)
    except GenerationError as exc:
        raise generation_error(exc) from None
