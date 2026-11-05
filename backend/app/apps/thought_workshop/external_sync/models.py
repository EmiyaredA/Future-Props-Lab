from datetime import datetime

from sqlalchemy import (
    JSON,
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

from app.runtime.ids import new_id
from app.runtime.orm_base import Base, external_id
from app.runtime.time import utc_now


class ArticleSyncBinding(Base):
    __tablename__ = "thought_sync_bindings"
    __table_args__ = (UniqueConstraint("note_id"), UniqueConstraint("target_key"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), index=True
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE")
    )
    connection_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("integration_external_connections"), ondelete="RESTRICT")
    )
    document_id: Mapped[str] = mapped_column(String(200))
    target_key: Mapped[str] = mapped_column(String(240))
    url: Mapped[str] = mapped_column(String(2048))
    title: Mapped[str] = mapped_column(String(240))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    last_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    last_note_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ArticleSyncTask(Base):
    __tablename__ = "thought_sync_tasks"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "operation_id"),
        Index(
            "uq_thought_sync_active_target",
            "target_key",
            unique=True,
            sqlite_where=text("status IN ('queued','running','needs_review')"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), index=True
    )
    note_id: Mapped[str] = mapped_column(String(36), index=True)
    binding_id: Mapped[str] = mapped_column(String(36))
    binding_revision: Mapped[int] = mapped_column(Integer)
    connection_id: Mapped[str] = mapped_column(String(36))
    connection_revision: Mapped[int] = mapped_column(Integer)
    target_key: Mapped[str] = mapped_column(String(240))
    actor: Mapped[dict] = mapped_column(JSON)
    operation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note_revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="preview")
    content: Mapped[dict] = mapped_column(JSON)
    remote: Mapped[dict] = mapped_column(JSON)
    checkpoint: Mapped[dict] = mapped_column(JSON, default=dict)
    message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ArticleSyncStep(Base):
    __tablename__ = "thought_sync_steps"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_sync_tasks.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="pending")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ArticleSyncAsset(Base):
    __tablename__ = "thought_sync_assets"
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_sync_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), primary_key=True
    )
