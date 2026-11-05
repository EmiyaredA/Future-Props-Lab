"""Models owns native task intents, original authorization and path-free observations."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class NativeBase(DeclarativeBase):
    pass


class NativeModelJob(NativeBase):
    __tablename__ = "model_native_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(200))
    operation: Mapped[str] = mapped_column(String(100))
    payload_sha256: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    worker_id: Mapped[str] = mapped_column(String(100), default="")
    lease_id: Mapped[str] = mapped_column(String(36), default="")
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outcome_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str] = mapped_column(String(100), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    output_descriptor: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    artifacts_removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class NativeModelProof(NativeBase):
    __tablename__ = "model_native_proofs"
    job_id: Mapped[str] = mapped_column(ForeignKey("model_native_jobs.id"), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    source_method: Mapped[str] = mapped_column(String(12))
    source_path: Mapped[str] = mapped_column(String(4096))
    assertion: Mapped[str] = mapped_column(String(8192))
    source_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class NativeModelObservation(NativeBase):
    __tablename__ = "model_native_observations"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


NATIVE_MODELS = (NativeModelJob, NativeModelProof, NativeModelObservation)
