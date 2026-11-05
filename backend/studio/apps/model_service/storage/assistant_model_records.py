"""Store provider-side Visual assistant lease, current round, and terminal receipt."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.runtime.time import utc_now


class AssistantModelBase(DeclarativeBase):
    pass


class VisualAssistantModelRun(AssistantModelBase):
    __tablename__ = "visual_assistant_model_runs"
    __table_args__ = (Index("ix_visual_assistant_model_runs_state", "state", "updated_at"),)

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(128))
    conversation_id: Mapped[str] = mapped_column(String(128))
    start_digest: Mapped[str] = mapped_column(String(64))
    model_id: Mapped[str] = mapped_column(String(128))
    model_signature: Mapped[str] = mapped_column(String(64))
    model_plan: Mapped[dict] = mapped_column(JSON)
    request_summary: Mapped[dict] = mapped_column(JSON)
    credential_attribution: Mapped[dict | None] = mapped_column(JSON)
    trace_id: Mapped[str] = mapped_column(String(128))
    lease_id: Mapped[str] = mapped_column(String(36))
    state: Mapped[str] = mapped_column(String(16), default="open")
    round_index: Mapped[int] = mapped_column(Integer, default=-1)
    round_digest: Mapped[str | None] = mapped_column(String(64))
    round_state: Mapped[str | None] = mapped_column(String(16))
    round_events: Mapped[list[dict]] = mapped_column(JSON, default=list)
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    settlement_sha256: Mapped[str | None] = mapped_column(String(64))
    settlement: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
