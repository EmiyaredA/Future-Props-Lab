"""Only management job receipts and sanitized host observations live in this database."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.runtime.time import utc_now
from fpl_runtime.native_records import NativeJobFields


class Base(DeclarativeBase):
    pass


class NativeJob(NativeJobFields, Base):
    __tablename__ = "management_native_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)


class HostSnapshot(Base):
    __tablename__ = "management_host_snapshot"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
