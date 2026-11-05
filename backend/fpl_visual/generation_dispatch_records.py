"""Persist Visual's source decision and the corresponding Models receipt."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.apps.visual_workshop.models import VisualGenerationTask
from app.runtime.time import utc_now


class DispatchBase(DeclarativeBase):
    pass


class VisualGenerationDecision(DispatchBase):
    __tablename__ = "visual_generation_decisions"
    __table_args__ = (Index("ix_visual_generation_decisions_state", "state", "updated_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(128))
    plan_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16))
    source_path: Mapped[str] = mapped_column(Text)
    source_assertion: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VisualGenerationDispatch(DispatchBase):
    __tablename__ = "visual_generation_dispatches"
    __table_args__ = (Index("ix_visual_generation_dispatches_checked", "checked_at"),)

    task_id: Mapped[str] = mapped_column(
        ForeignKey(VisualGenerationTask.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    plan_id: Mapped[str] = mapped_column(
        ForeignKey(VisualGenerationDecision.__table__.c.id, ondelete="RESTRICT")
    )
    provider_revision: Mapped[int] = mapped_column(Integer, default=-1)
    pending_asset_id: Mapped[str | None] = mapped_column(String(36))
    pending_receipt_id: Mapped[str | None] = mapped_column(String(128))
    remote_output_sha256: Mapped[str | None] = mapped_column(String(64))
    retry_assertion: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
