"""Historical Galgame records exchanged without rewriting stored Story versions."""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameStorySnapshot,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.schemas.story import GalgameStoryDocumentOut
from app.apps.galgame_workshop.story.document_values import normalize_story_document
from fpl_runtime.edit_receipt_migration import EditReceiptBatch, EditReceiptTransfer
from fpl_runtime.migration_batches import MigrationBatch, MigrationPage
from fpl_runtime.project_history_migration import ProjectDataset
from fpl_runtime.project_history_records import (
    DocumentRecord,
    HistoryRecord,
    Identifier,
    ProjectRecord,
)

from .migration_jobs import JOB_DATASETS
from .models import GalgameMigrationReceipt


def valid_story(document):
    try:
        normalize_story_document(document)
    except GalgameStoryDocumentInvalidError as exc:
        raise ValueError("迁移故事格式无效") from exc
    return document


class GalgameProjectRecord(ProjectRecord):
    status: Literal["draft", "completed"]
    is_official: bool


class StoryRecord(DocumentRecord):
    check_document = field_validator("document")(valid_story)


class SnapshotRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    story_revision: int = Field(ge=0, strict=True)
    reason: str = Field(max_length=64)
    document: dict
    created_at: datetime
    check_document = field_validator("document")(valid_story)


class AssetLinkRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    asset_id: Identifier
    created_at: datetime


class AssetMetadataRecord(HistoryRecord):
    asset_id: Identifier
    project_id: Identifier
    category: str = Field(max_length=32)
    virtual_path: str = Field(min_length=1, max_length=512)
    packaging_policy: Literal["auto", "include", "exclude"]
    checksum_sha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")
    width: int | None = Field(ge=0)
    height: int | None = Field(ge=0)
    duration_ms: int | None = Field(ge=0)
    transcript: str | None
    transcript_language: str | None = Field(max_length=16)
    transcript_status: str = Field(max_length=16)
    transcript_source: str | None = Field(max_length=16)
    transcript_revision: int = Field(ge=0, strict=True)
    transcript_segments: list[dict]
    updated_at: datetime


class AssetSettingsRecord(HistoryRecord):
    project_id: Identifier
    asr_model_id: Identifier | None
    default_language: str = Field(max_length=16)
    concurrency: int = Field(ge=1)
    revision: int = Field(ge=0, strict=True)
    updated_at: datetime


class Projects(MigrationBatch[GalgameProjectRecord]):
    dataset: Literal["galgame.projects"]


class Stories(MigrationBatch[StoryRecord]):
    dataset: Literal["galgame.stories"]


class Snapshots(MigrationBatch[SnapshotRecord]):
    dataset: Literal["galgame.snapshots"]


class AssetLinks(MigrationBatch[AssetLinkRecord]):
    dataset: Literal["galgame.asset-links"]


class AssetMetadata(MigrationBatch[AssetMetadataRecord]):
    dataset: Literal["galgame.asset-metadata"]


class AssetSettings(MigrationBatch[AssetSettingsRecord]):
    dataset: Literal["galgame.asset-settings"]


DATASETS = (
    ProjectDataset(
        "galgame.projects",
        GalgameWorkshopProject,
        GalgameProjectRecord,
        Projects,
        MigrationPage[Projects],
    ),
    ProjectDataset(
        "galgame.stories",
        GalgameStoryDocument,
        StoryRecord,
        Stories,
        MigrationPage[Stories],
        project=GalgameWorkshopProject,
        key="project_id",
        owns_record=False,
    ),
    ProjectDataset(
        "galgame.snapshots",
        GalgameStorySnapshot,
        SnapshotRecord,
        Snapshots,
        MigrationPage[Snapshots],
        project=GalgameWorkshopProject,
        owns_record=False,
    ),
    ProjectDataset(
        "galgame.asset-links",
        GalgameProjectAssetReference,
        AssetLinkRecord,
        AssetLinks,
        MigrationPage[AssetLinks],
        project=GalgameWorkshopProject,
        owns_record=False,
    ),
    ProjectDataset(
        "galgame.asset-metadata",
        GalgameAssetMetadata,
        AssetMetadataRecord,
        AssetMetadata,
        MigrationPage[AssetMetadata],
        project=GalgameWorkshopProject,
        key="asset_id",
        owns_record=False,
    ),
    ProjectDataset(
        "galgame.asset-settings",
        GalgameAssetSettings,
        AssetSettingsRecord,
        AssetSettings,
        MigrationPage[AssetSettings],
        project=GalgameWorkshopProject,
        key="project_id",
        owns_record=False,
    ),
    *JOB_DATASETS,
)


class OperationReceipts(EditReceiptBatch):
    dataset: Literal["galgame.operation-receipts"]


OPERATIONS = EditReceiptTransfer(
    "galgame",
    GalgameWorkshopProject,
    GalgameStoryDocument,
    GalgameStoryDocumentOut,
    OperationReceipts,
    GalgameMigrationReceipt,
)
