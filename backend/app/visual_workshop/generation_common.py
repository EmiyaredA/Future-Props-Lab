from __future__ import annotations

from app.core.time import iso_utc
from app.models import VisualGenerationBatch
from app.schemas.visual_generation import GenerationBatchOut


class GenerationError(Exception):
    def __init__(self, message: str, *, code: str = "generation_error", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def generation_batch_out(row: VisualGenerationBatch) -> GenerationBatchOut:
    return GenerationBatchOut(
        id=row.id,
        project_id=row.project_id,
        batch_kind=row.batch_kind,
        grid_size=row.grid_size,
        grid_output=row.grid_output,
        child_task_ids=list(row.child_task_ids or []),
        status=row.status,
        completed_count=row.completed_count,
        failed_count=row.failed_count,
        result_asset_id=row.result_asset_id,
        error_message=row.error_message,
        generation_node_id=row.generation_node_id,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        completed_at=iso_utc(row.completed_at) if row.completed_at else None,
    )
