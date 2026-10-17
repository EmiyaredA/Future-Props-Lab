from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
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


class ModelTestConversation(Base):
    __tablename__ = "model_test_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    title: Mapped[str] = mapped_column(String(120), default="新对话")
    model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=1024)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ModelTestMessage(Base):
    __tablename__ = "model_test_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "position", name="uq_model_test_message_position"),
        Index("ix_model_test_messages_conversation", "conversation_id", "position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("model_test_conversations.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    turn_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    model_slug: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(16), index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ModelTestAttachment(Base):
    __tablename__ = "model_test_attachments"
    __table_args__ = (
        UniqueConstraint(
            "message_id", "position", name="uq_model_test_attachment_message_position"
        ),
        Index(
            "ix_model_test_attachments_conversation",
            "conversation_id",
            "message_id",
            "position",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("model_test_conversations.id", ondelete="CASCADE"),
        index=True,
    )
    message_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("model_test_messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    mime_type: Mapped[str] = mapped_column(String(120))
    byte_size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ModelTestGenerationTask(Base):
    __tablename__ = "model_test_generation_tasks"
    __table_args__ = (
        Index("ix_model_test_generation_status_updated", "status", "updated_at"),
        Index("ix_model_test_generation_model_created", "model_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    provider_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_providers.id", ondelete="SET NULL")
    )
    model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL")
    )
    provider_kind: Mapped[str] = mapped_column(String(24))
    generation_kind: Mapped[str] = mapped_column(String(16))
    provider_name: Mapped[str] = mapped_column(String(120))
    model_slug: Mapped[str] = mapped_column(String(160))
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    provider_task_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    execution_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    result_url: Mapped[str | None] = mapped_column(Text)
    result_storage_key: Mapped[str | None] = mapped_column(String(64))
    result_filename: Mapped[str | None] = mapped_column(String(255))
    result_mime_type: Mapped[str | None] = mapped_column(String(120))
    result_byte_size: Mapped[int | None] = mapped_column(Integer)
    auth_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    api_key_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    api_key_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_key_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True)
    log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("llm_call_logs.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class ModelTestGenerationAsset(Base):
    __tablename__ = "model_test_generation_assets"
    __table_args__ = (
        UniqueConstraint(
            "task_id", "role", "position", name="uq_model_test_generation_asset_position"
        ),
        Index("ix_model_test_generation_assets_task", "task_id", "role", "position"),
        Index("ix_model_test_generation_assets_draft_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    task_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("model_test_generation_tasks.id", ondelete="CASCADE"),
        nullable=True,
    )
    role: Mapped[str | None] = mapped_column(String(24), nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    media_kind: Mapped[str] = mapped_column(String(16))
    mime_type: Mapped[str] = mapped_column(String(120))
    byte_size: Mapped[int] = mapped_column(Integer)
    legacy_visual_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ModelTestTranscriptionTask(Base):
    __tablename__ = "model_test_transcription_tasks"
    __table_args__ = (
        Index("ix_model_test_transcription_workspace_created", "workspace_id", "created_at"),
        Index("ix_model_test_transcription_status_created", "status", "created_at"),
        Index("ix_model_test_transcription_model_created", "model_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    provider_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_providers.id", ondelete="SET NULL")
    )
    model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL")
    )
    provider_kind: Mapped[str] = mapped_column(String(24))
    provider_name: Mapped[str] = mapped_column(String(120))
    model_slug: Mapped[str] = mapped_column(String(160))
    source_kind: Mapped[str] = mapped_column(String(16))
    source_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="SET NULL")
    )
    input_storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    input_filename: Mapped[str] = mapped_column(String(255))
    input_mime_type: Mapped[str] = mapped_column(String(120))
    input_byte_size: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(128), default="auto")
    request_options: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    result_text: Mapped[str | None] = mapped_column(Text)
    result_segments: Mapped[list[dict]] = mapped_column(JSON, default=list)
    result_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text)
    auth_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    api_key_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    api_key_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_key_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True)
    log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("llm_call_logs.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
