"""Owned Visual ORM roots, with no foreign model imports."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
    NodeAcceptanceBinding,
)
from app.apps.visual_workshop.asset_references.models import (
    VisualProjectAssetReference,
)
from app.apps.visual_workshop.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.outputs.models import (
    VisualNodeOutput,
)
from app.runtime.project_operations import ProjectOperationReceipt
from app.runtime.time import utc_now
from fpl_runtime.certification_owner import CertificationReceiptFields, CertificationRecordsBase
from fpl_runtime.reference_records import ReferenceMutationFields


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


MODELS = (
    AcceptanceTemplate,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceRun,
    AcceptanceAssetReference,
    NodeAcceptanceBinding,
    AcceptanceRepairDraft,
    VisualProjectAssetReference,
    VisualWorkshopProject,
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualGenerationBatch,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualAssistantAction,
    VisualNodeOutput,
    VisualCertificationReceipt,
    VisualCanvasReferenceMutation,
    VisualSegmentHandoff,
    ProjectOperationReceipt,
)
