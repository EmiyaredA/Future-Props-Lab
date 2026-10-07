from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.apps.visual_workshop.generation import GenerationError, VisualGeneration
from app.apps.visual_workshop.schemas.generation import (
    GenerationBatchListOut,
    GenerationBatchOut,
    ImageCompositionCreateIn,
    ImageGenerationBatchCreateIn,
)
from app.apps.visual_workshop.schemas.workshop import (
    GenerationOptionsOut,
    GenerationTaskCreateIn,
    GenerationTaskListOut,
    GenerationTaskOut,
)
from app.deps import SessionDep
from app.llm.routes.model_capacity import task_admission

router = APIRouter(prefix="/visual-workshop", tags=["visual-generation"])


def _generation_error(exc: GenerationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


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
        raise _generation_error(exc) from None


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
        raise _generation_error(exc) from None


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
        raise _generation_error(exc) from None


@router.get("/generation-tasks", response_model=GenerationTaskListOut)
async def list_generation_tasks(
    session: SessionDep,
    project_id: str | None = None,
    canvas_node_id: str | None = Query(default=None, min_length=1, max_length=64),
    kind: Literal["image", "video", "audio"] | None = None,
    status: Literal["queued", "submitting", "pending", "processing", "completed", "failed"]
    | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    current_nodes: bool = False,
) -> GenerationTaskListOut:
    try:
        return await VisualGeneration(session).list(
            project_id=project_id,
            canvas_node_id=canvas_node_id,
            kind=kind,
            status=status,
            page=page,
            page_size=page_size,
            current_nodes=current_nodes,
        )
    except GenerationError as exc:
        raise _generation_error(exc) from None


@router.get("/generation-tasks/{task_id}", response_model=GenerationTaskOut)
async def get_generation_task(session: SessionDep, task_id: str) -> GenerationTaskOut:
    try:
        return await VisualGeneration(session).get(task_id)
    except GenerationError as exc:
        raise _generation_error(exc) from None


@router.get("/generation-batches/{batch_id}", response_model=GenerationBatchOut)
async def get_generation_batch(session: SessionDep, batch_id: str) -> GenerationBatchOut:
    try:
        return await VisualGeneration(session).get_batch(batch_id)
    except GenerationError as exc:
        raise _generation_error(exc) from None


@router.post(
    "/generation-batches/{batch_id}/retry-composition",
    response_model=GenerationBatchOut,
)
async def retry_image_composition(session: SessionDep, batch_id: str) -> GenerationBatchOut:
    try:
        return await VisualGeneration(session).retry_composition(batch_id)
    except GenerationError as exc:
        raise _generation_error(exc) from None


@router.get("/generation-batches", response_model=GenerationBatchListOut)
async def list_generation_batches(
    session: SessionDep,
    project_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    current_nodes: bool = False,
) -> GenerationBatchListOut:
    try:
        return await VisualGeneration(session).list_batches(
            project_id, page, page_size, current_nodes
        )
    except GenerationError as exc:
        raise _generation_error(exc) from None


@router.post(
    "/generation-tasks/{task_id}/retry-materialization",
    response_model=GenerationTaskOut,
)
async def retry_materialization(session: SessionDep, task_id: str) -> GenerationTaskOut:
    try:
        return await VisualGeneration(session).retry_materialization(task_id)
    except GenerationError as exc:
        raise _generation_error(exc) from None
