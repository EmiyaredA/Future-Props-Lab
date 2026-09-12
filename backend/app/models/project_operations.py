"""Durable receipts for resource-scoped, revision-checked editing batches."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import utc_now


class ProjectOperationReceipt(Base):
    __tablename__ = "project_operation_receipts"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    resource_kind: Mapped[str] = mapped_column(String(40), primary_key=True)
    resource_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
