"""Owned Galgame ORM roots, with no foreign model imports."""

from sqlalchemy import Index

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
from fpl_runtime.certification_owner import CertificationReceiptFields, CertificationRecordsBase


class GalgameCertificationReceipt(CertificationReceiptFields, CertificationRecordsBase):
    __tablename__ = "galgame_certification_receipts"
    __table_args__ = (
        Index("ix_galgame_certification_receipts_pending", "audit_event_id", "created_at"),
    )


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
)
