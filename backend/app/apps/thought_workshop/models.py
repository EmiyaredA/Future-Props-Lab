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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.apps.thought_workshop.foreign_keys import external_id
from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class ThoughtKnowledgeBase(Base):
    __tablename__ = "thought_knowledge_bases"
    __table_args__ = (Index("ix_thought_knowledge_bases_account", "owner_user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    cover_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), nullable=True
    )
    home_note_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtNote(Base):
    __tablename__ = "thought_notes"
    __table_args__ = (
        Index("ix_thought_notes_account_updated", "owner_user_id", "updated_at"),
        Index("ix_thought_notes_knowledge_base", "knowledge_base_id"),
        Index("ix_thought_notes_parent", "parent_id"),
        Index(
            "ix_thought_notes_home",
            "knowledge_base_id",
            unique=True,
            sqlite_where=text("is_home = 1"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE")
    )
    knowledge_base_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_knowledge_bases.id", ondelete="CASCADE")
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="SET NULL"), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_home: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str] = mapped_column(String(240))
    kind: Mapped[str] = mapped_column(String(20), default="note")
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
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), primary_key=True
    )


class ThoughtNoteHistory(Base):
    __tablename__ = "thought_note_history"
    __table_args__ = (
        UniqueConstraint("note_id", "revision"),
        Index("ix_thought_history_note_revision", "note_id", "revision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE")
    )
    revision: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(240))
    document: Mapped[dict] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(Integer)
    tags: Mapped[list[str]] = mapped_column(JSON)
    author_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    author_name: Mapped[str] = mapped_column(String(120))
    source: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ThoughtHistoryAsset(Base):
    __tablename__ = "thought_history_assets"
    __table_args__ = (Index("ix_thought_history_assets_asset", "asset_id"),)

    history_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_note_history.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), primary_key=True
    )
