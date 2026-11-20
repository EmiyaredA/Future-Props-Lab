"""Published Visual task and batch operations with independently owned execution."""

from fastapi import APIRouter, Request

from studio.apps.visual_workshop.card_generation import CardGeneration
from studio.apps.visual_workshop.generation.generation_controls import GenerationControls
from studio.apps.visual_workshop.generation_errors import GenerationError
from studio.apps.visual_workshop.generation_routes import generation_error
from studio.apps.visual_workshop.schemas.card_generation import CardGenerationIn
from studio.apps.visual_workshop.schemas.generation import (
    GenerationBatchOut,
    GenerationCancelIn,
    ImageGenerationBatchCreateIn,
)
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskCreateIn, GenerationTaskOut
from studio.apps.visual_workshop.storage.card_generation import SqlCardGeneration
from studio.apps.visual_workshop.transport.generation_bindings import generation_intake
from studio.apps.visual_workshop.transport.project_errors import resolve
from studio.runtime.http.dependencies import OwnerDep, SessionDep

router = APIRouter(prefix="/v1/visual-workshop", tags=["visual-generation"])


@router.post("/projects/{project_id}/generation-tasks", response_model=GenerationTaskOut)
async def create_generation_task(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    body: GenerationTaskCreateIn,
):
    try:
        return await generation_intake(request, session, owner).create_task(project_id, body)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post(
    "/projects/{project_id}/asset-cards/{card_id}/generations", response_model=GenerationTaskOut
)
async def generate_visual_asset_card(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    card_id: str,
    body: CardGenerationIn,
):
    try:
        return await resolve(
            CardGeneration(
                SqlCardGeneration(session, owner, project_id, card_id, body), project_id, body
            ).run(generation_intake(request, session, owner).create_task)
        )
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post("/projects/{project_id}/generation-batches", response_model=GenerationBatchOut)
async def create_generation_batch(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    body: ImageGenerationBatchCreateIn,
):
    try:
        return await generation_intake(request, session, owner).create_batch(project_id, body)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post("/generation-tasks/{task_id}/cancel", response_model=GenerationTaskOut)
async def cancel_generation_task(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    task_id: str,
    body: GenerationCancelIn,
):
    try:
        return await GenerationControls(request, session, owner).change(
            task_id, "cancel", body.expected_revision
        )
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post("/generation-tasks/{task_id}/retry-materialization", response_model=GenerationTaskOut)
async def retry_materialization(
    request: Request, session: SessionDep, owner: OwnerDep, task_id: str
):
    try:
        return await GenerationControls(request, session, owner).change(task_id, "retry")
    except GenerationError as exc:
        raise generation_error(exc) from None
