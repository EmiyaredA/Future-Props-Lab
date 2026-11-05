"""Source receipts and pending archive publication outcomes."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class ThoughtArchiveImport(Base):
    __tablename__ = "thought_archive_imports"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "request_key"),
        Index("ix_thought_archive_imports_pending", "state", "updated_at"),
    )

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    request_key: Mapped[str | None] = mapped_column(String(128))
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16), default="staging")
    result: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
