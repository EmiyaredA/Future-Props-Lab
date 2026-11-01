from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class ModelTestTool(Base):
    __tablename__ = "model_test_tools"
    __table_args__ = (Index("ix_model_test_tools_account_updated", "owner_user_id", "updated_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    input_schema: Mapped[dict] = mapped_column(JSON, default=dict)
    mock_kind: Mapped[str] = mapped_column(String(16), default="success")
    mock_result: Mapped[object | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str] = mapped_column(String(120), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    delay_ms: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ModelTestConversationToolBinding(Base):
    __tablename__ = "model_test_conversation_tool_bindings"
    __table_args__ = (
        UniqueConstraint("conversation_id", "position", name="uq_model_test_binding_position"),
        Index("ix_model_test_conversation_tool_bindings_tool", "tool_id", "conversation_id"),
    )

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("model_test_conversations.id", ondelete="CASCADE"), primary_key=True
    )
    tool_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("model_test_tools.id", ondelete="RESTRICT"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ModelTestToolCall(Base):
    __tablename__ = "model_test_tool_calls"
    __table_args__ = (
        UniqueConstraint("message_id", "action_id", name="uq_model_test_tool_call_action"),
        Index("ix_model_test_tool_calls_account_created", "owner_user_id", "created_at"),
        Index("ix_model_test_tool_calls_tool_created", "tool_id", "created_at"),
        Index("ix_model_test_tool_calls_message", "message_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    tool_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_test_tools.id", ondelete="SET NULL"), nullable=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_test_conversations.id", ondelete="SET NULL"), nullable=True
    )
    message_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_test_messages.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(16))
    action_id: Mapped[str] = mapped_column(String(160), default="")
    run_id: Mapped[str] = mapped_column(String(36), default="")
    round_index: Mapped[int] = mapped_column(Integer, default=0)
    tool_name: Mapped[str] = mapped_column(String(64))
    tool_revision: Mapped[int] = mapped_column(Integer, default=0)
    definition_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    arguments: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16))
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    result: Mapped[object | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str] = mapped_column(String(120), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    configured_delay_ms: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
