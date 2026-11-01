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


class VisualWorkshopProject(Base):
    is_official: Mapped[bool] = mapped_column(Boolean, default=False)
    __tablename__ = "visual_workshop_projects"
    __table_args__ = (
        Index(
            "ix_visual_workshop_projects_updated_at",
            "updated_at",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualCanvasDocument(Base):
    __tablename__ = "visual_canvas_documents"

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    nodes: Mapped[list[dict]] = mapped_column(JSON, default=list)
    edges: Mapped[list[dict]] = mapped_column(JSON, default=list)
    categories: Mapped[list[dict]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualGenerationTask(Base):
    __tablename__ = "visual_generation_tasks"
    __table_args__ = (
        Index("ix_visual_generation_tasks_project_created", "project_id", "created_at"),
        Index(
            "ix_visual_generation_tasks_project_canvas_node_created",
            "project_id",
            "canvas_node_id",
            "created_at",
        ),
        Index("ix_visual_generation_tasks_status_updated", "status", "updated_at"),
        Index("ix_visual_generation_tasks_provider", "provider_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
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
    canvas_node_id: Mapped[str | None] = mapped_column(String(64), index=False)
    provider_task_id: Mapped[str | None] = mapped_column(String(255))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    execution_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    result_url: Mapped[str | None] = mapped_column(Text)
    result_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class VisualGenerationBatch(Base):
    __tablename__ = "visual_generation_batches"
    __table_args__ = (
        Index("ix_visual_generation_batches_project_created", "project_id", "created_at"),
        Index("ix_visual_generation_batches_status_updated", "status", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    batch_kind: Mapped[str] = mapped_column(String(16), default="generation")
    grid_size: Mapped[int] = mapped_column(Integer)
    grid_output: Mapped[str] = mapped_column(String(16), default="nodes")
    child_task_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_items: Mapped[list[dict]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    completed_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_count: Mapped[int] = mapped_column(Integer, default=0)
    result_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="SET NULL")
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    generation_node_id: Mapped[str | None] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class VisualAssistantConversation(Base):
    __tablename__ = "visual_assistant_conversations"
    __table_args__ = (
        Index(
            "ix_visual_assistant_conversations_project_updated",
            "project_id",
            "updated_at",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(120), default="AI 助手对话")
    model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL"), nullable=True
    )
    image_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL"), nullable=True
    )
    video_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL"), nullable=True
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualAssistantMessage(Base):
    __tablename__ = "visual_assistant_messages"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "position",
            name="uq_visual_assistant_message_position",
        ),
        Index(
            "ix_visual_assistant_messages_conversation",
            "conversation_id",
            "position",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("visual_assistant_conversations.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    turn_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    content_parts: Mapped[list[dict]] = mapped_column(JSON, default=list)
    model_slug: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(16), index=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualAssistantMessageAsset(Base):
    __tablename__ = "visual_assistant_message_assets"
    __table_args__ = (
        UniqueConstraint(
            "message_id", "position", name="uq_visual_assistant_message_asset_position"
        ),
        UniqueConstraint("message_id", "asset_id", name="uq_visual_assistant_message_asset"),
        Index("ix_visual_assistant_message_assets_asset", "asset_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assistant_messages.id", ondelete="CASCADE")
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="RESTRICT")
    )
    position: Mapped[int] = mapped_column(Integer)


class VisualAssistantAction(Base):
    __tablename__ = "visual_assistant_actions"
    __table_args__ = (
        UniqueConstraint("message_id", "action_id", name="uq_visual_assistant_action_id"),
        UniqueConstraint("message_id", "position", name="uq_visual_assistant_action_position"),
        Index("ix_visual_assistant_actions_message", "message_id", "position"),
        Index("ix_visual_assistant_actions_run", "run_id", "status"),
        Index("ix_visual_assistant_actions_generation_task", "generation_task_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assistant_messages.id", ondelete="CASCADE")
    )
    action_id: Mapped[str] = mapped_column(String(160))
    run_id: Mapped[str] = mapped_column(String(36))
    approval_group_id: Mapped[str | None] = mapped_column(String(36))
    position: Mapped[int] = mapped_column(Integer)
    tool_name: Mapped[str] = mapped_column(String(100))
    effect: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(24))
    display_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    canvas_revision: Mapped[int | None] = mapped_column(Integer)
    generation_task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_generation_tasks.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
