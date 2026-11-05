"""Serialize Galgame job results without loading their executors."""

from app.apps.galgame_workshop.models import (
    GalgameAnnotationImportTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
)
from app.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportTaskOut,
    GalgameVideoEditorHandoffTaskOut,
    GalgameVideoExportTaskOut,
)
from app.runtime.time import iso_utc


def annotation_task_out(row: GalgameAnnotationImportTask) -> GalgameAnnotationImportTaskOut:
    result = dict(row.result_detail or {})
    phase = result.get("phase")
    allowed_phases = {
        "queued",
        "cutting",
        "validating",
        "saving",
        "accepting",
        "rolling_back",
        "completed",
        "failed",
        "conflict",
        "rolled_back",
    }
    if phase not in allowed_phases:
        phase = "cutting" if row.status == "running" else row.status
    return GalgameAnnotationImportTaskOut(
        id=row.id,
        projectId=row.project_id,
        sourceProjectId=row.source_project_id,
        requestId=row.request_id,
        status=row.status,
        phase=phase,
        progress=row.progress,
        result=result,
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


def export_task_out(row: GalgameVideoExportTask) -> GalgameVideoExportTaskOut:
    result = dict(row.result_detail or {})
    phase = result.get("phase")
    if phase not in {
        "queued",
        "preparing",
        "analyzing",
        "rendering",
        "encoding",
        "verifying",
        "registering",
        "completed",
        "failed",
        "cancelled",
    }:
        phase = "rendering" if row.status == "running" else row.status
    return GalgameVideoExportTaskOut(
        id=row.id,
        projectId=row.project_id,
        requestId=row.request_id,
        storyRevision=row.story_revision,
        status=row.status,
        phase=phase,
        progress=row.progress,
        renderedMs=max(0, int(result.get("renderedMs", 0))),
        totalMs=max(0, int(result.get("totalMs", 0))),
        preset=row.request_payload.get("preset", "1080p30"),
        endingLabel=str(result.get("endingLabel", "")),
        outputAssetId=row.output_asset_id,
        outputFilename=result.get("outputFilename"),
        cancelRequested=row.cancel_requested,
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


def handoff_out(row: GalgameVideoEditorHandoffTask) -> GalgameVideoEditorHandoffTaskOut:
    detail = dict(row.result_detail or {})
    return GalgameVideoEditorHandoffTaskOut(
        id=row.id,
        projectId=row.project_id,
        requestId=row.request_id,
        storyRevision=row.story_revision,
        status=row.status,
        progress=row.progress,
        outputProjectId=row.output_project_id,
        trackCount=max(0, int(detail.get("trackCount", 0))),
        assetCount=max(0, int(detail.get("assetCount", 0))),
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
    )
