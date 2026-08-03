from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.deps import SessionDep
from app.schemas.visual_workshop import (
    GenerationOptionsOut,
    GenerationTaskCreateIn,
    GenerationTaskListOut,
    GenerationTaskOut,
)
from app.visual_workshop.generation import GenerationError, VisualGeneration

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
    session: SessionDep,
    project_id: str,
    body: GenerationTaskCreateIn,
) -> GenerationTaskOut:
    try:
        return await VisualGeneration(session).create(project_id, body)
    except GenerationError as exc:
        raise _generation_error(exc) from None


@router.get("/generation-tasks", response_model=GenerationTaskListOut)
async def list_generation_tasks(
    session: SessionDep,
    project_id: str | None = None,
    kind: Literal["image", "video"] | None = None,
    status: Literal["queued", "submitting", "pending", "processing", "completed", "failed"]
    | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> GenerationTaskListOut:
    return await VisualGeneration(session).list(
        project_id=project_id,
        kind=kind,
        status=status,
        page=page,
        page_size=page_size,
    )


@router.get("/generation-tasks/{task_id}", response_model=GenerationTaskOut)
async def get_generation_task(session: SessionDep, task_id: str) -> GenerationTaskOut:
    try:
        return await VisualGeneration(session).get(task_id)
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
