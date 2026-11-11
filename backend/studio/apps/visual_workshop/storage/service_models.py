"""Owned Visual ORM roots, with no foreign model imports."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.apps.asset_library.clients.reference_records import ReferenceMutationFields
from studio.apps.identity.clients.certification_records import (
    CertificationReceiptFields,
    CertificationRecordsBase,
)
from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
    NodeAcceptanceBinding,
)
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.generation_dispatch_records import (
    VisualGenerationDecision,
    VisualGenerationDispatch,
)
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.apps.visual_workshop.storage.review_dispatch_records import VisualReviewDispatch
from studio.runtime.database.migration_receipts import ImportReceiptFields
from studio.runtime.database.project_operations import ProjectOperationReceipt
from studio.runtime.time import utc_now


class VisualCertificationReceipt(CertificationReceiptFields, CertificationRecordsBase):
    __tablename__ = "visual_certification_receipts"
    __table_args__ = (
        Index("ix_visual_certification_receipts_pending", "audit_event_id", "created_at"),
    )


class CanvasRetentionBase(DeclarativeBase):
    pass


class VisualCanvasReferenceMutation(ReferenceMutationFields, CanvasRetentionBase):
    __tablename__ = "visual_canvas_reference_mutations"


class VisualSegmentHandoff(CanvasRetentionBase):
    __tablename__ = "visual_segment_handoffs"
    __table_args__ = (
        Index("ix_visual_segment_handoff_target", "owner_user_id", "project_id", "state"),
    )

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(128))
    scope_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16))
    nodes: Mapped[list] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VisualMigrationReceipt(ImportReceiptFields, CanvasRetentionBase):
    __tablename__ = "visual_migration_receipts"


class VisualSnapshotImportBatch(CanvasRetentionBase):
    __tablename__ = "visual_snapshot_import_batches"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VisualCompositionDispatch(CanvasRetentionBase):
    __tablename__ = "visual_composition_dispatches"

    batch_id: Mapped[str] = mapped_column(
        ForeignKey(VisualGenerationBatch.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    source_path: Mapped[str] = mapped_column(Text)
    assertion: Mapped[str] = mapped_column(Text)
    plan: Mapped[dict] = mapped_column(JSON)
    pending_asset_id: Mapped[str | None] = mapped_column(String(36))
    pending_receipt_id: Mapped[str | None] = mapped_column(String(128))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)


MODELS = (
    VisualReviewDispatch,
    VisualGenerationDecision,
    VisualGenerationDispatch,
    VisualCompositionDispatch,
    VisualSnapshotImportBatch,
    VisualMigrationReceipt,
    AcceptanceTemplate,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceRun,
    AcceptanceAssetReference,
    NodeAcceptanceBinding,
    AcceptanceRepairDraft,
    VisualWorkshopProject,
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualGenerationBatch,
    VisualNodeOutput,
    VisualCertificationReceipt,
    VisualCanvasReferenceMutation,
    VisualSegmentHandoff,
    ProjectOperationReceipt,
)
