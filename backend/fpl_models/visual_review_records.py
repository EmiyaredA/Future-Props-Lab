"""Durable provider receipt for one Visual review run."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.time import utc_now

from .orm import ModelsBase


class VisualReviewAttempt(ModelsBase):
    __tablename__ = "model_visual_review_attempts"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16), default="running")
    outcome: Mapped[dict | None] = mapped_column(JSON)
    lease_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
