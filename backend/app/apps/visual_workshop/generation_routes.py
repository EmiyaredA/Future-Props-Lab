from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.generation_records import GenerationRecords
from app.apps.visual_workshop.schemas.generation import (
    GenerationBatchListOut,
    GenerationBatchOut,
    GenerationCancelIn,
)
from app.apps.visual_workshop.schemas.workshop import GenerationTaskListOut, GenerationTaskOut
from app.deps import SessionDep

router = APIRouter(prefix="/visual-workshop", tags=["visual-generation"])


def generation_error(exc: GenerationError) -> HTTPException:
    return HTTPException(
        exc.status,
        {
            "code": exc.code,
            "message": str(exc),
            **({"current": exc.current} if exc.current is not None else {}),
        },
    )


@router.get("/generation-tasks", response_model=GenerationTaskListOut)
async def list_generation_tasks(
    session: SessionDep,
    project_id: str | None = None,
    canvas_node_id: str | None = Query(default=None, min_length=1, max_length=64),
    kind: Literal["image", "video", "audio"] | None = None,
    status: Literal[
        "queued", "submitting", "pending", "processing", "completed", "failed", "cancelled"
    ]
    | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    current_nodes: bool = False,
) -> GenerationTaskListOut:
    try:
        return await GenerationRecords(session).list(
            project_id=project_id,
            canvas_node_id=canvas_node_id,
            kind=kind,
            status=status,
            page=page,
            page_size=page_size,
            current_nodes=current_nodes,
        )
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.get("/generation-tasks/{task_id}", response_model=GenerationTaskOut)
async def get_generation_task(session: SessionDep, task_id: str) -> GenerationTaskOut:
    try:
        return await GenerationRecords(session).get(task_id)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.get("/generation-batches/{batch_id}", response_model=GenerationBatchOut)
async def get_generation_batch(session: SessionDep, batch_id: str) -> GenerationBatchOut:
    try:
        return await GenerationRecords(session).get_batch(batch_id)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.get("/generation-batches", response_model=GenerationBatchListOut)
async def list_generation_batches(
    session: SessionDep,
    project_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    current_nodes: bool = False,
) -> GenerationBatchListOut:
    try:
        return await GenerationRecords(session).list_batches(
            project_id, page, page_size, current_nodes
        )
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post(
    "/generation-tasks/{task_id}/retry-materialization",
    response_model=GenerationTaskOut,
)
async def retry_materialization(session: SessionDep, task_id: str) -> GenerationTaskOut:
    try:
        return await GenerationRecords(session).retry_materialization(task_id)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post("/generation-tasks/{task_id}/cancel", response_model=GenerationTaskOut)
async def cancel_generation_task(session: SessionDep, task_id: str, body: GenerationCancelIn):
    try:
        return await GenerationRecords(session).cancel(task_id, body.expected_revision)
    except GenerationError as exc:
        raise generation_error(exc) from None
