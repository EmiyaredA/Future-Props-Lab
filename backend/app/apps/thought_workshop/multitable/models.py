"""Owned children of a Workspace-scoped ThoughtNote; no dynamic database tables."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class DataTable(Base):
    __tablename__ = "thought_data_tables"
    __table_args__ = (Index("ix_thought_data_tables_note", "note_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    note_id: Mapped[str] = mapped_column(ForeignKey("thought_notes.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer)


class DataField(Base):
    __tablename__ = "thought_data_fields"
    __table_args__ = (Index("ix_thought_data_fields_table", "table_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    table_id: Mapped[str] = mapped_column(ForeignKey("thought_data_tables.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(20))
    position: Mapped[int] = mapped_column(Integer)
    options: Mapped[list] = mapped_column(JSON, default=list)


class DataView(Base):
    __tablename__ = "thought_data_views"
    __table_args__ = (Index("ix_thought_data_views_table", "table_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    table_id: Mapped[str] = mapped_column(ForeignKey("thought_data_tables.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(20))
    position: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict] = mapped_column(JSON, default=dict)


class DataRecord(Base):
    __tablename__ = "thought_data_records"
    __table_args__ = (Index("ix_thought_data_records_table", "table_id", "position"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    table_id: Mapped[str] = mapped_column(ForeignKey("thought_data_tables.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    values: Mapped[dict] = mapped_column(JSON, default=dict)


class DataChange(Base):
    __tablename__ = "thought_data_changes"
    __table_args__ = (UniqueConstraint("note_id", "revision"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    note_id: Mapped[str] = mapped_column(ForeignKey("thought_notes.id", ondelete="CASCADE"))
    revision: Mapped[int] = mapped_column(Integer)
    changes: Mapped[list] = mapped_column(JSON)
    checkpoint: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    author_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DataAsset(Base):
    __tablename__ = "thought_data_assets"
    note_id: Mapped[str] = mapped_column(
        ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="RESTRICT"), primary_key=True
    )
