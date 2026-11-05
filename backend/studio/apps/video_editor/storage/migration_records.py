"""Preserve Video projects, timelines, media metadata, receipts and task history."""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from studio.apps.video_editor.schemas import VideoEditorDefaultEffects, VideoEditorTimelineBatchIn
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from studio.apps.video_editor.storage.service_models import VideoMediaDispatch
from studio.contracts.management.editing_artifacts import video_media_id
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import (
    DocumentRecord,
    HistoryRecord,
    Identifier,
    OperationRecord,
    ProjectRecord,
    TaskRecord,
)
from studio.contracts.video_editor.timeline_document import parse_timeline_document
from studio.runtime.database.project_history_migration import ProjectDataset


class VideoProjectRecord(ProjectRecord):
    status: Literal["draft", "completed"]
    source_application: str | None = Field(max_length=32)
    source_project_id: Identifier | None
    source_revision: int | None = Field(ge=0, strict=True)
    source_compiler_version: str | None = Field(max_length=64)


class VideoTimelineRecord(DocumentRecord):
    @field_validator("document")
    @classmethod
    def check_document(cls, document):
        parse_timeline_document(document)
        return document


class VideoOperationRecord(OperationRecord):
    @model_validator(mode="after")
    def validate_receipt(self):
        VideoEditorTimelineBatchIn.model_validate(
            {
                "expectedRevision": self.base_revision,
                "requestId": self.request_id,
                "operations": self.operations,
            }
        )
        return self


class VideoMediaRecord(HistoryRecord):
    asset_id: Identifier
    project_id: Identifier
    processing_status: Literal["queued", "processing", "ready", "failed"]
    probe: dict
    fingerprint: str = Field(pattern=r"^([0-9a-f]{64})?$")
    proxy_filename: str | None = Field(max_length=255)
    thumbnail_filename: str | None = Field(max_length=255)
    waveform_filename: str | None = Field(max_length=255)
    error: str | None
    default_effects: dict
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime

    @field_validator("default_effects")
    @classmethod
    def check_effects(cls, effects):
        VideoEditorDefaultEffects.model_validate(effects)
        return effects


class VideoTaskRecord(TaskRecord):
    kind: Literal["media", "render", "segment_export", "asset_bake", "clip_merge"]
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    result_detail: dict
    output_asset_id: Identifier | None
    revision: int = Field(ge=0, strict=True)
    started_at: datetime | None
    finished_at: datetime | None

    @field_validator("snapshot_document")
    @classmethod
    def check_snapshot(cls, document):
        if document:
            parse_timeline_document(document)
        return document


class Projects(MigrationBatch[VideoProjectRecord]):
    dataset: Literal["video.projects"]


class Timelines(MigrationBatch[VideoTimelineRecord]):
    dataset: Literal["video.timelines"]


class Media(MigrationBatch[VideoMediaRecord]):
    dataset: Literal["video.media"]


class Operations(MigrationBatch[VideoOperationRecord]):
    dataset: Literal["video.operations"]


class Tasks(MigrationBatch[VideoTaskRecord]):
    dataset: Literal["video.tasks"]


def historical_media(owner, record):
    if not (record.proxy_filename or record.thumbnail_filename or record.waveform_filename):
        return None
    return VideoMediaDispatch(
        task_id=video_media_id(record.asset_id),
        owner_user_id=owner,
        project_id=record.project_id,
        asset_id=record.asset_id,
        historical=True,
    )


DATASETS = (
    ProjectDataset(
        "video.projects", VideoEditorProject, VideoProjectRecord, Projects, MigrationPage[Projects]
    ),
    ProjectDataset(
        "video.timelines",
        VideoEditorTimeline,
        VideoTimelineRecord,
        Timelines,
        MigrationPage[Timelines],
        key="project_id",
        project=VideoEditorProject,
        owns_record=False,
    ),
    ProjectDataset(
        "video.media",
        VideoEditorAssetMetadata,
        VideoMediaRecord,
        Media,
        MigrationPage[Media],
        key="asset_id",
        project=VideoEditorProject,
        owns_record=False,
        projection=historical_media,
    ),
    ProjectDataset(
        "video.operations",
        VideoEditorOperationBatch,
        VideoOperationRecord,
        Operations,
        MigrationPage[Operations],
        project=VideoEditorProject,
    ),
    ProjectDataset(
        "video.tasks",
        VideoEditorTask,
        VideoTaskRecord,
        Tasks,
        MigrationPage[Tasks],
        project=VideoEditorProject,
    ),
)
