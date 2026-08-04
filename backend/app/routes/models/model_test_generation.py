from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.deps import SessionDep
from app.llm.playground.generation import ModelTestGeneration, ModelTestGenerationError
from app.llm.playground.generation_assets import (
    GenerationAssetError,
    ModelTestGenerationAssets,
)
from app.schemas.model_test import (
    ModelTestGenerationAssetBackfillOut,
    ModelTestGenerationAssetBackfillStatusOut,
    ModelTestGenerationAssetCleanupOut,
    ModelTestGenerationAssetListOut,
    ModelTestGenerationCreateIn,
    ModelTestGenerationOptionListOut,
    ModelTestGenerationTaskListOut,
    ModelTestGenerationTaskOut,
)

router = APIRouter(prefix="/model-test", tags=["model-test"])


def _translate(exc: ModelTestGenerationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


def _translate_asset(exc: GenerationAssetError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.post("/generation-assets", response_model=ModelTestGenerationAssetListOut)
async def upload_generation_assets(
    session: SessionDep,
    files: Annotated[list[UploadFile], File()],
) -> ModelTestGenerationAssetListOut:
    try:
        return await ModelTestGenerationAssets(session).upload(files)
    except GenerationAssetError as exc:
        raise _translate_asset(exc) from None


@router.delete("/generation-assets/{asset_id}")
async def delete_generation_asset(session: SessionDep, asset_id: str) -> dict[str, bool]:
    try:
        await ModelTestGenerationAssets(session).delete_draft(asset_id)
    except GenerationAssetError as exc:
        raise _translate_asset(exc) from None
    return {"deleted": True}


@router.post("/generation-assets/cleanup", response_model=ModelTestGenerationAssetCleanupOut)
async def cleanup_generation_assets(session: SessionDep) -> ModelTestGenerationAssetCleanupOut:
    return await ModelTestGenerationAssets(session).cleanup()


@router.get(
    "/generation-assets/backfill-status",
    response_model=ModelTestGenerationAssetBackfillStatusOut,
)
async def generation_asset_backfill_status(
    session: SessionDep,
) -> ModelTestGenerationAssetBackfillStatusOut:
    return await ModelTestGenerationAssets(session).backfill_status()


@router.post("/generation-assets/backfill", response_model=ModelTestGenerationAssetBackfillOut)
async def backfill_generation_assets(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=100),
) -> ModelTestGenerationAssetBackfillOut:
    return await ModelTestGenerationAssets(session).backfill(limit)


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
