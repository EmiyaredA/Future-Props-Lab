"""Durable delivery of account creation to the independently owned model catalog."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class AccountEvent(Base):
    __tablename__ = "identity_account_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class ModelAuditDelivery(Base):
    __tablename__ = "identity_model_audit_receipts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    audit_event_id: Mapped[str] = mapped_column(String(36), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ModelAuditIntent(Base):
    __tablename__ = "identity_model_audit_intents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class IntegrationIntent(Base):
    __tablename__ = "identity_integration_intents"
    __table_args__ = (UniqueConstraint("caller", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    caller: Mapped[str] = mapped_column(String(32))
    request_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    source_method: Mapped[str] = mapped_column(String(12))
    source_path: Mapped[str] = mapped_column(String(4096))
    actor: Mapped[dict] = mapped_column(JSON)
    scope: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
