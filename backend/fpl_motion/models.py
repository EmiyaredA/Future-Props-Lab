"""Durable source decisions for project file layout changes."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.runtime.time import utc_now
from fpl_runtime.reference_records import ReferenceMutationFields


class MotionLifecycleBase(DeclarativeBase):
    pass


class MotionReferenceMutation(ReferenceMutationFields, MotionLifecycleBase):
    __tablename__ = "motion_reference_mutations"


class MotionImportBatch(MotionLifecycleBase):
    __tablename__ = "motion_import_batches"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staging")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class MotionExportBinding(MotionLifecycleBase):
    __tablename__ = "motion_export_bindings"

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    remote_id: Mapped[str] = mapped_column(String(32))
    request_path: Mapped[str] = mapped_column(String(512))
    assertion: Mapped[str] = mapped_column(Text)
    frozen_request: Mapped[dict] = mapped_column(JSON)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
