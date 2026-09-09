from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class ThoughtKnowledgeBase(Base):
    __tablename__ = "thought_knowledge_bases"
    __table_args__ = (Index("ix_thought_knowledge_bases_workspace", "workspace_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    cover_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="RESTRICT"), nullable=True
    )
    home_note_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtFolder(Base):
    __tablename__ = "thought_folders"
    __table_args__ = (Index("ix_thought_folders_knowledge_base", "knowledge_base_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    knowledge_base_id: Mapped[str] = mapped_column(
        ForeignKey("thought_knowledge_bases.id", ondelete="CASCADE")
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("thought_folders.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtNote(Base):
    __tablename__ = "thought_notes"
    __table_args__ = (
        Index("ix_thought_notes_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_thought_notes_knowledge_base", "knowledge_base_id"),
        Index("ix_thought_notes_folder", "folder_id"),
        Index(
            "ix_thought_notes_home",
            "knowledge_base_id",
            unique=True,
            sqlite_where=text("is_home = 1"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    knowledge_base_id: Mapped[str] = mapped_column(
        ForeignKey("thought_knowledge_bases.id", ondelete="CASCADE")
    )
    folder_id: Mapped[str | None] = mapped_column(
        ForeignKey("thought_folders.id", ondelete="SET NULL"), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_home: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str] = mapped_column(String(240))
    document: Mapped[dict] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(Integer, default=2)
    search_text: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtNoteAsset(Base):
    __tablename__ = "thought_note_assets"
    __table_args__ = (Index("ix_thought_note_assets_asset", "asset_id"),)

    note_id: Mapped[str] = mapped_column(
        ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="RESTRICT"), primary_key=True
    )
