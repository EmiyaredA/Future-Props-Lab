from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class ThoughtDocumentReference(Base):
    __tablename__ = "thought_document_references"
    __table_args__ = (Index("ix_thought_reference_target", "target_id"),)
    note_id: Mapped[str] = mapped_column(
        ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    target_id: Mapped[str] = mapped_column(String(36), primary_key=True)


class ThoughtTemplate(Base):
    __tablename__ = "thought_templates"
    __table_args__ = (Index("ix_thought_templates_workspace", "workspace_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    document: Mapped[dict] = mapped_column(JSON)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    schema_version: Mapped[int] = mapped_column(Integer, default=3)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtTemplateAsset(Base):
    __tablename__ = "thought_template_assets"
    __table_args__ = (Index("ix_thought_template_assets_asset", "asset_id"),)
    template_id: Mapped[str] = mapped_column(
        ForeignKey("thought_templates.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="RESTRICT"), primary_key=True
    )


class ThoughtCheckpoint(Base):
    __tablename__ = "thought_checkpoints"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    note_id: Mapped[str] = mapped_column(ForeignKey("thought_notes.id", ondelete="CASCADE"))
    history_id: Mapped[str] = mapped_column(
        ForeignKey("thought_note_history.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(120))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtSavedFilter(Base):
    __tablename__ = "thought_saved_filters"
    __table_args__ = (Index("ix_thought_filters_owner", "workspace_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    criteria: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class ThoughtReadingState(Base):
    __tablename__ = "thought_reading_states"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", "resource_id"),
        Index("ix_thought_reading_owner", "workspace_id", "user_id", "visited_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    resource_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(240))
    position: Mapped[dict] = mapped_column(JSON, default=dict)
    visited_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
