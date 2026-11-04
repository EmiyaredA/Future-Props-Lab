"""Owned Visual ORM roots, with no foreign model imports."""

from sqlalchemy import Index

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
from fpl_runtime.certification_owner import CertificationReceiptFields, CertificationRecordsBase


class VisualCertificationReceipt(CertificationReceiptFields, CertificationRecordsBase):
    __tablename__ = "visual_certification_receipts"
    __table_args__ = (
        Index("ix_visual_certification_receipts_pending", "audit_event_id", "created_at"),
    )


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
)
