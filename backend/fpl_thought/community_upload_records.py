"""Pending attachments stay tied to their editor and published source article."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class ThoughtCommunityUpload(Base):
    __tablename__ = "thought_community_upload_intents"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "request_key"),
        Index("ix_thought_community_upload_intents_pending", "state", "updated_at"),
    )

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    request_key: Mapped[str | None] = mapped_column(String(64))
    request_sha256: Mapped[str] = mapped_column(String(64), index=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    scope: Mapped[dict] = mapped_column(JSON)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16), default="staging")
    result: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
