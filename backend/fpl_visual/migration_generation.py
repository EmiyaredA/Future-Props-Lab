"""Historical Visual generation jobs, including provider receipts and batch membership."""

from datetime import datetime
from typing import Literal

from pydantic import Field
from sqlalchemy import select

from app.apps.visual_workshop.models import (
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.schemas.workshop import GenerationTaskStatus
from fpl_runtime.migration_batches import MigrationBatch, MigrationPage
from fpl_runtime.project_history_migration import ProjectDataset, blocked
from fpl_runtime.project_history_records import HistoryRecord, Identifier


class GenerationTaskRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    provider_id: Identifier | None
    model_id: Identifier | None
    provider_kind: str = Field(min_length=1, max_length=24)
    generation_kind: Literal["image", "audio", "video"]
    provider_name: str = Field(max_length=120)
    model_slug: str = Field(max_length=160)
    request_payload: dict
    canvas_node_id: str | None = Field(max_length=64)
    provider_task_id: str | None = Field(max_length=255)
    submitted_at: datetime | None
    status: GenerationTaskStatus
    progress: int = Field(ge=0, le=100, strict=True)
    execution_info: dict | None
    error_message: str | None
    result_url: str | None
    result_asset_id: Identifier | None
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class GenerationBatchRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    batch_kind: Literal["generation", "composition"]
    grid_size: Literal[4, 9]
    grid_output: Literal["nodes", "composite"]
    child_task_ids: list[Identifier]
    source_items: list[dict]
    status: Literal["queued", "processing", "completed", "failed", "cancelled"]
    completed_count: int = Field(ge=0, strict=True)
    failed_count: int = Field(ge=0, strict=True)
    cancelled_count: int = Field(ge=0, strict=True)
    result_asset_id: Identifier | None
    error_message: str | None
    generation_node_id: str | None = Field(max_length=64)
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class GenerationTasks(MigrationBatch[GenerationTaskRecord]):
    dataset: Literal["visual.generation-tasks"]


class GenerationBatches(MigrationBatch[GenerationBatchRecord]):
    dataset: Literal["visual.generation-batches"]


async def validate_batch_tasks(session, record):
    if record.batch_kind == "composition" and record.status in {"queued", "processing"}:
        raise blocked("migration_visual_composition_active")
    if not record.child_task_ids:
        return
    saved = set(
        await session.scalars(
            select(VisualGenerationTask.id).where(
                VisualGenerationTask.id.in_(record.child_task_ids),
                VisualGenerationTask.project_id == record.project_id,
                VisualGenerationTask.owner_user_id == session.info["owner_user_id"],
            )
        )
    )
    if len(saved) != len(record.child_task_ids):
        raise blocked("migration_visual_batch_task_conflict")


DATASETS = (
    ProjectDataset(
        "visual.generation-tasks",
        VisualGenerationTask,
        GenerationTaskRecord,
        GenerationTasks,
        MigrationPage[GenerationTasks],
        project=VisualWorkshopProject,
    ),
    ProjectDataset(
        "visual.generation-batches",
        VisualGenerationBatch,
        GenerationBatchRecord,
        GenerationBatches,
        MigrationPage[GenerationBatches],
        project=VisualWorkshopProject,
        validate=validate_batch_tasks,
    ),
)
