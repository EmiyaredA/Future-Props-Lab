"""Project Annotation records and validated edit history from the sealed legacy store."""

from datetime import datetime
from typing import Literal

from pydantic import Field, ValidationError, model_validator
from sqlalchemy import func, literal, select
from sqlalchemy.orm import DeclarativeBase

from studio.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
    AudioAnnotationWaveformPutIn,
)
from studio.contracts.audio_annotation.migration import (
    PINS_DATASET,
    AnnotationPin,
    AnnotationPinBatch,
    AnnotationPinPage,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier, ProjectRecord
from studio.runtime.database.migration_receipts import ImportReceiptFields
from studio.runtime.database.project_history_migration import CURSOR, ProjectDataset, blocked
from studio.runtime.database.project_operations import ProjectOperationReceipt


class ReceiptBase(DeclarativeBase):
    pass


class AnnotationImportReceipt(ImportReceiptFields, ReceiptBase):
    __tablename__ = "annotation_import_receipts"


class Project(ProjectRecord):
    asset_id: Identifier
    duration_ms: int = Field(gt=0, le=3_600_000)


class Document(HistoryRecord):
    project_id: Identifier
    schema_version: Literal["1.0"]
    speakers: list[dict]
    custom_emotions: list[dict | str]
    segments: list[dict]
    revision: int = Field(ge=0)
    updated_at: datetime

    def validate_content(self):
        return AudioAnnotationDocumentPutIn(
            expected_revision=self.revision,
            schema_version=self.schema_version,
            speakers=self.speakers,
            custom_emotions=self.custom_emotions,
            segments=self.segments,
        )


class Waveform(HistoryRecord):
    project_id: Identifier
    duration_ms: int = Field(gt=0, le=3_600_000)
    peaks: list[list[float]]
    revision: int = Field(ge=0)
    updated_at: datetime

    @model_validator(mode="after")
    def validate_channels(self):
        if self.peaks:
            AudioAnnotationWaveformPutIn(
                expected_revision=self.revision, duration_ms=self.duration_ms, peaks=self.peaks
            )
        return self


class Operation(HistoryRecord):
    resource_id: Identifier
    resource_kind: Literal["annotation"]
    request_id: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    result: dict
    created_at: datetime

    @property
    def id(self):
        return f"{self.resource_id}:{self.request_id.encode().hex().upper()}"

    @model_validator(mode="after")
    def validate_result(self):
        if AudioAnnotationDocumentOut.model_validate(self.result).project_id != self.resource_id:
            raise ValueError("标注回执与项目 ID 不一致")
        return self


class ProjectBatch(MigrationBatch[Project]):
    dataset: Literal["annotation.projects"]


class DocumentBatch(MigrationBatch[Document]):
    dataset: Literal["annotation.documents"]


class WaveformBatch(MigrationBatch[Waveform]):
    dataset: Literal["annotation.waveforms"]


class OperationBatch(MigrationBatch[Operation]):
    dataset: Literal["annotation.operation-receipts"]


class LegacyPin(AnnotationPin):
    @model_validator(mode="before")
    @classmethod
    def project_original(cls, row):
        if isinstance(row, AudioAnnotationProject):
            return {"id": row.id, "revision": row.revision, "asset_ids": [row.asset_id]}
        return row


class OperationDataset(ProjectDataset):
    def select(self, *columns):
        return super().select(*columns).where(self.model.resource_kind == "annotation")

    def key_for(self, row):
        if row is self.model:
            return self.model.resource_id + literal(":") + func.hex(self.model.request_id)
        return row.id


async def verify_document(session, record):
    project = await session.get(AudioAnnotationProject, record.project_id)
    if project is None:
        raise blocked("migration_annotation_project_missing")
    try:
        document = record.validate_content()
    except ValidationError:
        raise blocked("migration_annotation_document_invalid") from None
    speaker_ids = {speaker.id for speaker in document.speakers}
    previous = -1
    for segment in document.segments:
        if (
            segment.end_ms - segment.start_ms < 100
            or segment.end_ms > project.duration_ms
            or segment.start_ms < previous
            or not set(segment.speaker_ids) <= speaker_ids
        ):
            raise blocked("migration_annotation_document_invalid")
        previous = segment.start_ms


async def verify_waveform(session, record):
    project = await session.get(AudioAnnotationProject, record.project_id)
    if project is None or record.duration_ms != project.duration_ms:
        raise blocked("migration_annotation_waveform_duration_conflict")


async def verify_operation(session, record):
    document = await session.get(AudioAnnotationDocument, record.resource_id)
    if document is None or record.result["revision"] > document.revision:
        raise blocked("migration_annotation_operation_revision_conflict")


async def verify_project_coverage(sessions):
    async with sessions(info={"allow_system_reads": True}) as session:
        for model in (AudioAnnotationDocument, AudioAnnotationWaveform):
            missing = await session.scalar(
                select(AudioAnnotationProject.id)
                .outerjoin(model, model.project_id == AudioAnnotationProject.id)
                .where(model.project_id.is_(None))
                .limit(1)
            )
            if missing is not None:
                raise blocked("migration_annotation_project_incomplete")
        count = await session.scalar(select(func.count()).select_from(AudioAnnotationProject))
    return {"record_count": count}


OPERATIONS = OperationDataset(
    "annotation.operation-receipts",
    ProjectOperationReceipt,
    Operation,
    OperationBatch,
    MigrationPage[OperationBatch],
    project=AudioAnnotationProject,
    parent_key="resource_id",
    cursor_pattern=CURSOR[:-1] + r":[0-9A-F]{2,512}$",
    validate=verify_operation,
)
PINS = ProjectDataset(
    PINS_DATASET, AudioAnnotationProject, LegacyPin, AnnotationPinBatch, AnnotationPinPage
)
DATASETS = (
    ProjectDataset(
        "annotation.projects",
        AudioAnnotationProject,
        Project,
        ProjectBatch,
        MigrationPage[ProjectBatch],
        page_size=32,
    ),
    ProjectDataset(
        "annotation.documents",
        AudioAnnotationDocument,
        Document,
        DocumentBatch,
        MigrationPage[DocumentBatch],
        key="project_id",
        project=AudioAnnotationProject,
        owns_record=False,
        validate=verify_document,
    ),
    ProjectDataset(
        "annotation.waveforms",
        AudioAnnotationWaveform,
        Waveform,
        WaveformBatch,
        MigrationPage[WaveformBatch],
        key="project_id",
        project=AudioAnnotationProject,
        owns_record=False,
        validate=verify_waveform,
    ),
    OPERATIONS,
)
