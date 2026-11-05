"""Presentation owns documents and the durable outcome of its Assets references."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.apps.asset_library.clients.reference_records import ReferenceMutationFields
from studio.apps.presentation_workshop.storage.models import PresentationProject
from studio.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationTemplate,
)
from studio.runtime.database.migration_receipts import ImportReceiptFields
from studio.runtime.database.project_operations import ProjectOperationReceipt
from studio.runtime.time import utc_now


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


class PresentationMigrationReceipt(ImportReceiptFields, PresentationRetentionBase):
    __tablename__ = "presentation_migration_receipts"


MODELS = (
    PresentationProject,
    PresentationTemplate,
    PresentationExample,
    ProjectOperationReceipt,
    PresentationReferenceMutation,
    PresentationImportBatch,
)
