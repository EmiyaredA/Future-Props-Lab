"""Presentation owns documents and the durable outcome of its Assets references."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.apps.presentation_workshop.models import PresentationProject
from app.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationTemplate,
)
from app.runtime.project_operations import ProjectOperationReceipt
from app.runtime.time import utc_now
from fpl_runtime.reference_records import ReferenceMutationFields


class PresentationRetentionBase(DeclarativeBase):
    pass


class PresentationReferenceMutation(ReferenceMutationFields, PresentationRetentionBase):
    __tablename__ = "presentation_reference_mutations"


class PresentationImportBatch(PresentationRetentionBase):
    __tablename__ = "presentation_import_batches"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


MODELS = (
    PresentationProject,
    PresentationTemplate,
    PresentationExample,
    ProjectOperationReceipt,
    PresentationReferenceMutation,
    PresentationImportBatch,
)
