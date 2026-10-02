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


class DesktopPetProject(Base):
    __tablename__ = "desktop_pet_projects"
    __table_args__ = (Index("ix_desktop_pet_workspace_updated", "workspace_id", "updated_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source_type: Mapped[str] = mapped_column(String(32), default="live2d")
    source_project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_title: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(120))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    character: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    whale_model: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    whale_assets: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    config: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DesktopPetChat(Base):
    __tablename__ = "desktop_pet_chats"
    __table_args__ = (
        UniqueConstraint("workspace_id", "project_id", "user_id"),
        Index("ix_desktop_pet_chats_user", "user_id", "workspace_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("desktop_pet_projects.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    model_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_entries.id", ondelete="SET NULL"), nullable=True
    )
    proactive_lines_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    active_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DesktopPetChatMessage(Base):
    __tablename__ = "desktop_pet_chat_messages"
    __table_args__ = (
        UniqueConstraint("chat_id", "position"),
        UniqueConstraint("chat_id", "request_id"),
        Index("ix_desktop_pet_chat_messages_chat", "chat_id", "position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    chat_id: Mapped[str] = mapped_column(ForeignKey("desktop_pet_chats.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DesktopPetChatRequest(Base):
    __tablename__ = "desktop_pet_chat_requests"

    chat_id: Mapped[str] = mapped_column(
        ForeignKey("desktop_pet_chats.id", ondelete="CASCADE"), primary_key=True
    )
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
