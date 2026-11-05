"""Owned execution receipts contain fixed scopes and inert intent IDs, never source JWTs."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.time import utc_now

from .orm import IntegrationsBase


class ValidationAttempt(IntegrationsBase):
    __tablename__ = "integration_validation_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    scope: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24))
    released: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ExternalExecution(IntegrationsBase):
    __tablename__ = "integration_external_executions"
    __table_args__ = (
        Index(
            "uq_integration_external_active_document",
            "document_id",
            unique=True,
            sqlite_where=text("status IN ('active', 'unknown')"),
        ),
    )
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    intent_id: Mapped[str] = mapped_column(String(36), unique=True)
    input_sha256: Mapped[str] = mapped_column(String(64))
    connection_id: Mapped[str] = mapped_column(String(100))
    connection_revision: Mapped[int] = mapped_column(Integer)
    document_id: Mapped[str] = mapped_column(String(200))
    payload: Mapped[dict] = mapped_column(JSON)
    checkpoint: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ExternalStepReceipt(IntegrationsBase):
    __tablename__ = "integration_external_step_receipts"
    __table_args__ = (UniqueConstraint("task_id", "action_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    task_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("integration_external_executions.task_id", ondelete="CASCADE"),
        index=True,
    )
    action_key: Mapped[str] = mapped_column(String(250))
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24))
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ExternalClosure(IntegrationsBase):
    __tablename__ = "integration_external_closures"
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    note_id: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AmadeusToolCall(IntegrationsBase):
    __tablename__ = "integration_amadeus_tool_calls"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(24))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
