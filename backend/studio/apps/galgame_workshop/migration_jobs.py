"""Historical Galgame jobs and their replay identifiers."""

from datetime import datetime
from typing import Literal

from pydantic import Field
from sqlalchemy import column, func, or_, select, table

from studio.apps.galgame_workshop.storage.models import (
    GalgameAnnotationImportTask,
    GalgameAssetTranscriptionTask,
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

TaskStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class JobRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    revision: int = Field(ge=0, strict=True)
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class AsrJobRecord(JobRecord):
    asset_id: Identifier
    provider_id: Identifier | None
    provider_name: str = Field(max_length=120)
    model_id: Identifier | None
    model_slug: str = Field(max_length=160)
    language: str = Field(max_length=16)
    force: bool
    status: Literal["queued", "running", "completed", "failed"]
    result_text: str | None
    result_segments: list[dict]


class DispatchJobRecord(JobRecord):
    request_id: str = Field(min_length=1, max_length=64)
    request_payload: dict
    progress: int = Field(ge=0, le=100)
    result_detail: dict
    updated_at: datetime


class AnnotationJobRecord(DispatchJobRecord):
    source_project_id: Identifier
    expected_source_revision: int = Field(ge=0, strict=True)
    expected_story_revision: int = Field(ge=0, strict=True)
    status: Literal["queued", "running", "completed", "failed", "conflict", "rolled_back"]


class StoryJobRecord(DispatchJobRecord):
    snapshot_id: Identifier
    story_revision: int = Field(ge=0, strict=True)
    status: TaskStatus
    cancel_requested: bool


class VideoExportRecord(StoryJobRecord):
    output_asset_id: Identifier | None


class VideoHandoffRecord(StoryJobRecord):
    output_project_id: Identifier | None


class AsrJobs(MigrationBatch[AsrJobRecord]):
    dataset: Literal["galgame.asr-jobs"]


class AnnotationJobs(MigrationBatch[AnnotationJobRecord]):
    dataset: Literal["galgame.annotation-jobs"]


class VideoExports(MigrationBatch[VideoExportRecord]):
    dataset: Literal["galgame.video-exports"]


class VideoHandoffs(MigrationBatch[VideoHandoffRecord]):
    dataset: Literal["galgame.video-handoffs"]


LEGACY_ASSETS = table(
    "visual_assets",
    column("id"),
    column("owner_user_id"),
    column("galgame_project_id"),
    column("media_kind"),
)
LEGACY_ANNOTATION = table("audio_annotation_projects", column("id"), column("owner_user_id"))
LEGACY_VIDEO = table("video_editor_projects", column("id"), column("owner_user_id"))


async def verify_legacy_job_links(session):
    for model, field, target, kind in (
        (
            GalgameAssetTranscriptionTask,
            GalgameAssetTranscriptionTask.asset_id,
            LEGACY_ASSETS,
            "audio",
        ),
        (GalgameVideoExportTask, GalgameVideoExportTask.output_asset_id, LEGACY_ASSETS, "video"),
        (
            GalgameAnnotationImportTask,
            GalgameAnnotationImportTask.source_project_id,
            LEGACY_ANNOTATION,
            None,
        ),
        (
            GalgameVideoEditorHandoffTask,
            GalgameVideoEditorHandoffTask.output_project_id,
            LEGACY_VIDEO,
            None,
        ),
    ):
        columns = target.c
        invalid = [columns.id.is_(None), columns.owner_user_id != model.owner_user_id]
        if kind is not None:
            invalid.extend(
                (
                    columns.galgame_project_id.is_(None),
                    columns.galgame_project_id != model.project_id,
                    columns.media_kind != kind,
                )
            )
        conflicts = await session.scalar(
            select(func.count())
            .select_from(model)
            .outerjoin(target, field == columns.id)
            .where(field.is_not(None), or_(*invalid))
        )
        if conflicts:
            raise blocked("migration_galgame_task_link_conflict")


async def verify_snapshot(session, record):
    snapshot = await session.get(GalgameStorySnapshot, record.snapshot_id)
    if (
        snapshot is None
        or snapshot.project_id != record.project_id
        or snapshot.story_revision != record.story_revision
    ):
        raise blocked("migration_galgame_task_snapshot_conflict")


JOB_DATASETS = (
    ProjectDataset(
        "galgame.asr-jobs",
        GalgameAssetTranscriptionTask,
        AsrJobRecord,
        AsrJobs,
        MigrationPage[AsrJobs],
        project=GalgameWorkshopProject,
    ),
    ProjectDataset(
        "galgame.annotation-jobs",
        GalgameAnnotationImportTask,
        AnnotationJobRecord,
        AnnotationJobs,
        MigrationPage[AnnotationJobs],
        project=GalgameWorkshopProject,
    ),
    ProjectDataset(
        "galgame.video-exports",
        GalgameVideoExportTask,
        VideoExportRecord,
        VideoExports,
        MigrationPage[VideoExports],
        project=GalgameWorkshopProject,
        validate=verify_snapshot,
    ),
    ProjectDataset(
        "galgame.video-handoffs",
        GalgameVideoEditorHandoffTask,
        VideoHandoffRecord,
        VideoHandoffs,
        MigrationPage[VideoHandoffs],
        project=GalgameWorkshopProject,
        validate=verify_snapshot,
    ),
)
