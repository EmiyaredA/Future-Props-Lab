"""Agent-owned native job receipts; no account or foreign-service ORM dependency."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.apps.agent_workbench.storage.models import WorkbenchSource
from studio.runtime.database.native_records import NativeJobFields
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class NativeBase(DeclarativeBase):
    pass


class NativeJob(NativeBase):
    __tablename__ = "agent_native_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(200))
    operation: Mapped[str] = mapped_column(String(100))
    payload_sha256: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    worker_id: Mapped[str] = mapped_column(String(100), default="")
    lease_id: Mapped[str] = mapped_column(String(36), default="")
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outcome_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str] = mapped_column(String(100), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class NativeSubscription(NativeBase):
    __tablename__ = "agent_native_subscriptions"
    source_id: Mapped[str] = mapped_column(
        ForeignKey(WorkbenchSource.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    current_job_id: Mapped[str] = mapped_column(ForeignKey("agent_native_jobs.id"))
    source_revision: Mapped[int] = mapped_column(Integer)
    authorization_revision: Mapped[int] = mapped_column(Integer)
    scan_epoch: Mapped[str] = mapped_column(String(100))
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class NativeProjectionReceipt(NativeBase):
    __tablename__ = "agent_native_projection_receipts"
    source_id: Mapped[str] = mapped_column(
        ForeignKey(WorkbenchSource.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    locator_sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    source_revision: Mapped[int] = mapped_column(Integer)
    frame_id: Mapped[str] = mapped_column(String(36))
    payload_sha256: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class NativeWorkerSeen(NativeBase):
    __tablename__ = "agent_native_worker_seen"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class WorkbenchExecutionJob(NativeJobFields, NativeBase):
    __tablename__ = "agent_workbench_execution_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
