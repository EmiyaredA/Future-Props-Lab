from __future__ import annotations

from app.apps.visual_workshop.models import VisualGenerationBatch, VisualGenerationTask
from app.apps.visual_workshop.schemas.generation import GenerationBatchOut
from app.apps.visual_workshop.schemas.workshop import GenerationTaskOut
from app.llm.generation_state import can_recover_generation_result
from app.runtime.time import iso_utc


class GenerationError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "generation_error",
        status: int = 422,
        current: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.current = current


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
        cancelled_count=row.cancelled_count,
        result_asset_id=row.result_asset_id,
        error_message=row.error_message,
        generation_node_id=row.generation_node_id,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        completed_at=iso_utc(row.completed_at) if row.completed_at else None,
    )


def generation_task_out(row: VisualGenerationTask) -> GenerationTaskOut:
    return GenerationTaskOut(
        id=row.id,
        project_id=row.project_id,
        provider_id=row.provider_id,
        model_id=row.model_id,
        provider_kind=row.provider_kind,
        kind=row.generation_kind,
        provider_name=row.provider_name,
        model_slug=row.model_slug,
        request_payload=dict(row.request_payload or {}),
        canvas_node_id=row.canvas_node_id,
        provider_task_id=row.provider_task_id,
        status=row.status,
        progress=row.progress,
        execution_info=row.execution_info,
        error_message=row.error_message,
        result_asset_id=row.result_asset_id,
        can_cancel=row.status == "queued" and row.generation_kind in {"image", "video"},
        queue_message="任务已排队，获得生成额度后将自动执行"
        if row.status == "queued" and row.generation_kind in {"image", "video"}
        else None,
        can_retry_materialization=can_recover_generation_result(row),
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        completed_at=iso_utc(row.completed_at) if row.completed_at else None,
    )
