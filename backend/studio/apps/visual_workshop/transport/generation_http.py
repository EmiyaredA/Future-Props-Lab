"""Published Visual task and batch operations with independently owned execution."""

from fastapi import APIRouter, Request

from studio.apps.visual_workshop.generation.generation_controls import GenerationControls
from studio.apps.visual_workshop.generation.generation_intake import GenerationIntake
from studio.apps.visual_workshop.generation_common import GenerationError
from studio.apps.visual_workshop.generation_routes import generation_error
from studio.apps.visual_workshop.schemas.generation import (
    GenerationBatchOut,
    GenerationCancelIn,
    ImageGenerationBatchCreateIn,
)
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskCreateIn, GenerationTaskOut
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
        return await GenerationIntake.from_request(request, session, owner).create_task(
            project_id, body
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
        return await GenerationIntake.from_request(request, session, owner).create_batch(
            project_id, body
        )
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
