"""Visual's durable side of an assistant call, separate from provider receipts."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.apps.visual_workshop.storage.models import (
    VisualAssistantConversation,
    VisualAssistantMessage,
)
from studio.runtime.time import utc_now


class AssistantDispatchBase(DeclarativeBase):
    pass


class VisualAssistantDispatch(AssistantDispatchBase):
    __tablename__ = "visual_assistant_dispatches"
    __table_args__ = (Index("ix_visual_assistant_dispatches_phase", "phase", "updated_at"),)

    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(128))
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey(VisualAssistantConversation.__table__.c.id, ondelete="CASCADE")
    )
    message_id: Mapped[str | None] = mapped_column(
        ForeignKey(VisualAssistantMessage.__table__.c.id, ondelete="CASCADE")
    )
    trace_id: Mapped[str] = mapped_column(String(36))
    phase: Mapped[str] = mapped_column(String(16), default="preparing")
    settlement: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
