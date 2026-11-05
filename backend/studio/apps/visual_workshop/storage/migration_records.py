"""Historical Visual project, Canvas and output records owned by Visual."""

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from studio.apps.visual_workshop.migration_acceptance import DATASETS as ACCEPTANCE_DATASETS
from studio.apps.visual_workshop.migration_assistant import DATASETS as ASSISTANT_DATASETS
from studio.apps.visual_workshop.migration_generation import DATASETS as GENERATION_DATASETS
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualWorkshopProjectKind,
    VisualWorkshopProjectStatus,
)
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument, VisualWorkshopProject
from studio.apps.visual_workshop.storage.service_models import VisualMigrationReceipt
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier, ProjectRecord
from studio.runtime.database.edit_receipt_migration import EditReceiptBatch, EditReceiptTransfer
from studio.runtime.database.project_history_migration import ProjectDataset


class VisualProjectRecord(ProjectRecord):
    kind: VisualWorkshopProjectKind
    status: VisualWorkshopProjectStatus
    is_official: bool


class CanvasRecord(HistoryRecord):
    project_id: Identifier
    nodes: list[dict]
    edges: list[dict]
    categories: list[dict]
    revision: int = Field(ge=0, strict=True)
    updated_at: datetime

    @model_validator(mode="after")
    def validate_saved_document(self):
        VisualCanvasDocumentOut.model_validate(
            {
                **self.model_dump(),
                "updated_at": self.updated_at.isoformat(),
            }
        )
        return self


class OutputRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    node_id: str = Field(min_length=1, max_length=64)
    version: int = Field(ge=1, strict=True)
    kind: Literal["text", "image", "video", "audio"]
    asset_id: Identifier | None
    inspection_asset_id: Identifier | None
    text: str | None
    source: str = Field(min_length=1, max_length=16)
    source_key: str = Field(min_length=1, max_length=160)
    generation_task_id: Identifier | None
    input_snapshot: list[dict]
    is_final: bool
    created_at: datetime


class Projects(MigrationBatch[VisualProjectRecord]):
    dataset: Literal["visual.projects"]


class Canvas(MigrationBatch[CanvasRecord]):
    dataset: Literal["visual.canvases"]


class Outputs(MigrationBatch[OutputRecord]):
    dataset: Literal["visual.outputs"]


DATASETS = (
    ProjectDataset(
        "visual.projects",
        VisualWorkshopProject,
        VisualProjectRecord,
        Projects,
        MigrationPage[Projects],
    ),
    ProjectDataset(
        "visual.canvases",
        VisualCanvasDocument,
        CanvasRecord,
        Canvas,
        MigrationPage[Canvas],
        project=VisualWorkshopProject,
        key="project_id",
        owns_record=False,
    ),
    ProjectDataset(
        "visual.outputs",
        VisualNodeOutput,
        OutputRecord,
        Outputs,
        MigrationPage[Outputs],
        project=VisualWorkshopProject,
        owns_record=False,
    ),
    *GENERATION_DATASETS,
    *ASSISTANT_DATASETS,
    *ACCEPTANCE_DATASETS,
)


class OperationReceipts(EditReceiptBatch):
    dataset: Literal["visual.operation-receipts"]


OPERATIONS = EditReceiptTransfer(
    "visual",
    VisualWorkshopProject,
    VisualCanvasDocument,
    VisualCanvasDocumentOut,
    OperationReceipts,
    VisualMigrationReceipt,
)
