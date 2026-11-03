"""Thought-owned prospective asset pins and source transaction outcomes."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.runtime.time import utc_now


class RetentionBase(DeclarativeBase):
    pass


class ThoughtReferenceMutation(RetentionBase):
    __tablename__ = "thought_reference_mutations"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    change_sha256: Mapped[str] = mapped_column(String(64))
    change: Mapped[dict] = mapped_column(JSON)
    authority: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), default="preparing", index=True)
    asset_intent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resource_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    delivered_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
