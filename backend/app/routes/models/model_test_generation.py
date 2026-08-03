from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.deps import SessionDep
from app.llm.playground.generation import ModelTestGeneration, ModelTestGenerationError
from app.schemas.model_test import (
    ModelTestGenerationCreateIn,
    ModelTestGenerationOptionListOut,
    ModelTestGenerationTaskListOut,
    ModelTestGenerationTaskOut,
)

router = APIRouter(prefix="/model-test", tags=["model-test"])


def _translate(exc: ModelTestGenerationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/generation-options", response_model=ModelTestGenerationOptionListOut)
async def generation_options(session: SessionDep) -> ModelTestGenerationOptionListOut:
    return await ModelTestGeneration(session).options()


@router.post("/generation-tasks", response_model=ModelTestGenerationTaskOut)
async def create_generation_task(
    session: SessionDep, body: ModelTestGenerationCreateIn
) -> ModelTestGenerationTaskOut:
    try:
        return await ModelTestGeneration(session).create(body)
    except ModelTestGenerationError as exc:
        raise _translate(exc) from None


@router.get("/generation-tasks", response_model=ModelTestGenerationTaskListOut)
async def list_generation_tasks(
    session: SessionDep,
    model_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> ModelTestGenerationTaskListOut:
    return await ModelTestGeneration(session).list(
        model_id=model_id, page=page, page_size=page_size
    )


@router.get("/generation-tasks/{task_id}", response_model=ModelTestGenerationTaskOut)
async def get_generation_task(session: SessionDep, task_id: str) -> ModelTestGenerationTaskOut:
    try:
        return await ModelTestGeneration(session).get(task_id)
    except ModelTestGenerationError as exc:
        raise _translate(exc) from None


@router.delete("/generation-tasks/{task_id}")
async def delete_generation_task(
    session: SessionDep,
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await ModelTestGeneration(session).delete(task_id, expected_revision)
    except ModelTestGenerationError as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post(
    "/generation-tasks/{task_id}/retry-materialization",
    response_model=ModelTestGenerationTaskOut,
)
async def retry_materialization(session: SessionDep, task_id: str) -> ModelTestGenerationTaskOut:
    try:
        return await ModelTestGeneration(session).retry_materialization(task_id)
    except ModelTestGenerationError as exc:
        raise _translate(exc) from None


@router.get("/generation-tasks/{task_id}/content")
async def generation_content(session: SessionDep, task_id: str) -> FileResponse:
    try:
        row, path = await ModelTestGeneration(session).content(task_id)
    except ModelTestGenerationError as exc:
        raise _translate(exc) from None
    return FileResponse(
        path,
        media_type=row.result_mime_type or "application/octet-stream",
        filename=row.result_filename or f"model-test-{task_id}",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
