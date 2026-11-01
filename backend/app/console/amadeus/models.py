from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class AmadeusConversation(Base):
    __tablename__ = "amadeus_conversations"
    __table_args__ = (
        Index("ix_amadeus_conversations_owner_updated", "owner_user_id", "user_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"))
    executor_kind: Mapped[str] = mapped_column(String(24), default="code-agent")
    agent_id: Mapped[str | None] = mapped_column(String(24), nullable=True)
    title: Mapped[str] = mapped_column(String(120), default="新对话")
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AmadeusMessage(Base):
    __tablename__ = "amadeus_messages"
    __table_args__ = (
        Index("ix_amadeus_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("amadeus_conversations.id", ondelete="CASCADE")
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    references_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("amadeus_runs.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(24), default="completed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AmadeusAction(Base):
    __tablename__ = "amadeus_actions"
    __table_args__ = (
        Index("ix_amadeus_actions_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("amadeus_conversations.id", ondelete="CASCADE")
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"))
    tool_name: Mapped[str] = mapped_column(String(120))
    arguments_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    arguments_sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24))
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("amadeus_runs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AmadeusRun(Base):
    __tablename__ = "amadeus_runs"
    __table_args__ = (
        Index("ix_amadeus_runs_owner_updated", "owner_user_id", "user_id", "updated_at"),
        Index("ix_amadeus_runs_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("amadeus_conversations.id", ondelete="CASCADE")
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[str | None] = mapped_column(String(24), nullable=True)
    agent_model: Mapped[str] = mapped_column(String(160), default="")
    execution_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    model_id: Mapped[str] = mapped_column(String(36))
    mode: Mapped[str] = mapped_column(String(12), default="agent")
    source_run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("amadeus_runs.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    status: Mapped[str] = mapped_column(String(24))
    active_owner_key: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    context_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    references_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    capabilities_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    partial_text: Mapped[str] = mapped_column(Text, default="")
    last_event_sequence: Mapped[int] = mapped_column(Integer, default=0)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AmadeusQuestion(Base):
    __tablename__ = "amadeus_questions"
    __table_args__ = (
        UniqueConstraint("run_id"),
        Index("ix_amadeus_questions_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("amadeus_conversations.id", ondelete="CASCADE")
    )
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("amadeus_runs.id", ondelete="CASCADE")
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"))
    tool_call_id: Mapped[str] = mapped_column(String(120))
    prompt: Mapped[str] = mapped_column(Text)
    options_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    allow_text: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    answer_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AmadeusRunEvent(Base):
    __tablename__ = "amadeus_run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence"),
        UniqueConstraint("run_id", "idempotency_key"),
        Index("ix_amadeus_run_events_run_sequence", "run_id", "sequence"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("amadeus_runs.id", ondelete="CASCADE")
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(40))
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
