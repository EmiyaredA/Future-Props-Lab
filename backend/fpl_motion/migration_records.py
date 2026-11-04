"""Preserve Motion projects, operation receipts and exact export history."""

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.apps.motion_compositor.models import (
    MotionDocument,
    MotionOperationBatch,
    MotionProject,
    MotionTask,
)
from app.apps.motion_compositor.schemas import ExportCreateIn, OperationBatchIn
from app.capabilities.media_rendering.motion_document import MotionComposition
from fpl_runtime.editing_artifacts import motion_render_id
from fpl_runtime.migration_batches import MigrationBatch, MigrationPage
from fpl_runtime.project_history_migration import ProjectDataset
from fpl_runtime.project_history_records import (
    DocumentRecord,
    OperationRecord,
    ProjectRecord,
    TaskRecord,
)

from .models import MotionExportBinding


class MotionDocumentRecord(DocumentRecord):
    @field_validator("document")
    @classmethod
    def check_document(cls, document):
        MotionComposition.model_validate(document)
        return document


class MotionOperationRecord(OperationRecord):
    result_document: dict

    @model_validator(mode="after")
    def validate_receipt(self):
        OperationBatchIn.model_validate(
            {
                "expectedRevision": self.base_revision,
                "requestId": self.request_id,
                "operations": self.operations,
            }
        )
        MotionComposition.model_validate(self.result_document)
        return self


class MotionTaskRecord(TaskRecord):
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    outputs: dict[str, str] = Field(max_length=3)

    @model_validator(mode="after")
    def check_export(self):
        request = ExportCreateIn.model_validate(self.request_payload)
        MotionComposition.model_validate(self.snapshot_document)
        if self.request_id != request.request_id or set(self.outputs) - set(request.formats):
            raise ValueError("特效任务回执与原请求不符")
        if self.status == "completed" and set(self.outputs) != set(request.formats):
            raise ValueError("已完成的特效任务缺少输出")
        return self


class Projects(MigrationBatch[ProjectRecord]):
    dataset: Literal["motion.projects"]


class Documents(MigrationBatch[MotionDocumentRecord]):
    dataset: Literal["motion.documents"]


class Operations(MigrationBatch[MotionOperationRecord]):
    dataset: Literal["motion.operations"]


class Tasks(MigrationBatch[MotionTaskRecord]):
    dataset: Literal["motion.tasks"]


def completed_binding(owner, task):
    if task.status != "completed":
        return None
    return MotionExportBinding(
        task_id=task.id,
        owner_user_id=owner,
        remote_id=motion_render_id(task.id),
        request_path="",
        assertion="",
        frozen_request={},
    )


DATASETS = (
    ProjectDataset(
        "motion.projects", MotionProject, ProjectRecord, Projects, MigrationPage[Projects]
    ),
    ProjectDataset(
        "motion.documents",
        MotionDocument,
        MotionDocumentRecord,
        Documents,
        MigrationPage[Documents],
        key="project_id",
        project=MotionProject,
        owns_record=False,
    ),
    ProjectDataset(
        "motion.operations",
        MotionOperationBatch,
        MotionOperationRecord,
        Operations,
        MigrationPage[Operations],
        project=MotionProject,
    ),
    ProjectDataset(
        "motion.tasks",
        MotionTask,
        MotionTaskRecord,
        Tasks,
        MigrationPage[Tasks],
        project=MotionProject,
        projection=completed_binding,
    ),
)
