"""Owned Galgame ORM roots, with no foreign model imports."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

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
from app.runtime.time import utc_now
from fpl_runtime.certification_owner import CertificationReceiptFields, CertificationRecordsBase
from fpl_runtime.migration_receipts import ImportReceiptFields
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


class GalgameMigrationReceipt(ImportReceiptFields, StoryRetentionBase):
    __tablename__ = "galgame_migration_receipts"


class GalgameUploadIntake(StoryRetentionBase):
    __tablename__ = "galgame_upload_intakes"
    __table_args__ = (
        Index("ix_galgame_upload_intakes_pending", "state", "checked_at"),
        Index("ix_galgame_upload_intakes_project", "owner_user_id", "project_id", "state"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(GalgameWorkshopProject.__table__.c.id, ondelete="CASCADE")
    )
    target_path: Mapped[str] = mapped_column(String(512))
    assertion: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32))
    planned: Mapped[list] = mapped_column(JSON)
    manifest: Mapped[dict] = mapped_column(JSON)
    receipt: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="reserved")
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GalgameAnnotationAuthorization(StoryRetentionBase):
    __tablename__ = "galgame_annotation_authorizations"

    task_id: Mapped[str] = mapped_column(
        ForeignKey(GalgameAnnotationImportTask.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    assertion: Mapped[str] = mapped_column(Text)


class GalgameSnapshotImportBatch(StoryRetentionBase):
    __tablename__ = "galgame_snapshot_import_batches"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GalgameAsrDispatch(StoryRetentionBase):
    __tablename__ = "galgame_asr_dispatches"

    task_id: Mapped[str] = mapped_column(
        ForeignKey(GalgameAssetTranscriptionTask.__table__.c.id, ondelete="CASCADE"),
        primary_key=True,
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    assertion: Mapped[str] = mapped_column(Text)
    asset_revision: Mapped[int] = mapped_column(Integer)
    transcript_revision: Mapped[int] = mapped_column(Integer)
    byte_limit: Mapped[int] = mapped_column(Integer)
    input: Mapped[dict | None] = mapped_column(JSON)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)


class GalgameVideoDispatch(StoryRetentionBase):
    __tablename__ = "galgame_video_dispatches"

    task_id: Mapped[str] = mapped_column(
        ForeignKey(GalgameVideoExportTask.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    assertion: Mapped[str] = mapped_column(Text)
    plan: Mapped[dict] = mapped_column(JSON)
    upload_id: Mapped[str | None] = mapped_column(String(32))
    media: Mapped[dict | None] = mapped_column(JSON)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)


MODELS = (
    GalgameMigrationReceipt,
    GalgameUploadIntake,
    GalgameAnnotationAuthorization,
    GalgameSnapshotImportBatch,
    GalgameAsrDispatch,
    GalgameVideoDispatch,
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
