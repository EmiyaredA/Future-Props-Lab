"""Owned Galgame ORM roots, with no foreign model imports."""

from sqlalchemy import Index
from sqlalchemy.orm import DeclarativeBase

from app.apps.galgame_workshop.models import (
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from app.runtime.project_operations import ProjectOperationReceipt
from fpl_runtime.certification_owner import CertificationReceiptFields, CertificationRecordsBase
from fpl_runtime.reference_records import ReferenceMutationFields


class GalgameCertificationReceipt(CertificationReceiptFields, CertificationRecordsBase):
    __tablename__ = "galgame_certification_receipts"
    __table_args__ = (
        Index("ix_galgame_certification_receipts_pending", "audit_event_id", "created_at"),
    )


class StoryRetentionBase(DeclarativeBase):
    pass


class GalgameStoryReferenceMutation(ReferenceMutationFields, StoryRetentionBase):
    __tablename__ = "galgame_story_reference_mutations"


MODELS = (
    GalgameWorkshopProject,
    GalgameStoryDocument,
    GalgameProjectAssetReference,
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
    GalgameStorySnapshot,
    GalgameAnnotationImportTask,
    GalgameVideoExportTask,
    GalgameVideoEditorHandoffTask,
    GalgameCertificationReceipt,
    GalgameStoryReferenceMutation,
    ProjectOperationReceipt,
)
