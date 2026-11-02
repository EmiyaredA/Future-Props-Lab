from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class WorkbenchSource(Base):
    __tablename__ = "agent_workbench_sources"
    __table_args__ = (UniqueConstraint("agent_id", "root", "endpoint"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    agent_id: Mapped[str] = mapped_column(String(24))
    label: Mapped[str] = mapped_column(String(120))
    root: Mapped[str] = mapped_column(Text)
    endpoint: Mapped[str] = mapped_column(String(255), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    message: Mapped[str] = mapped_column(String(500), default="等待首次扫描")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class WorkbenchSession(Base):
    __tablename__ = "agent_workbench_sessions"
    __table_args__ = (UniqueConstraint("owner_user_id", "agent_id", "native_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    agent_id: Mapped[str] = mapped_column(String(24))
    native_id: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(120), default="未命名会话")
    alias: Mapped[str] = mapped_column(String(120), default="")
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    cwd: Mapped[str] = mapped_column(Text, default="")
    origins: Mapped[list] = mapped_column(JSON, default=list)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    native_model: Mapped[str] = mapped_column(String(255), default="")
    parent_native_id: Mapped[str | None] = mapped_column(String(255))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[str] = mapped_column(String(64), default="")
    last_synced_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class WorkbenchEntry(Base):
    __tablename__ = "agent_workbench_entries"
    __table_args__ = (UniqueConstraint("session_id", "native_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("agent_workbench_sessions.id", ondelete="CASCADE"), index=True
    )
    native_id: Mapped[str] = mapped_column(String(255))
    ordinal: Mapped[int] = mapped_column(Integer, index=True)
    role: Mapped[str] = mapped_column(String(24))
    kind: Mapped[str] = mapped_column(String(32))
    text: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[str] = mapped_column(String(64), default="")
    parent_id: Mapped[str | None] = mapped_column(String(255))
    tool_name: Mapped[str] = mapped_column(String(255), default="")
    attachments: Mapped[list] = mapped_column(JSON, default=list)


class WorkbenchCheckpoint(Base):
    __tablename__ = "agent_workbench_checkpoints"
    __table_args__ = (UniqueConstraint("source_id", "locator"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("agent_workbench_sources.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_workbench_sessions.id", ondelete="CASCADE"), index=True
    )
    locator: Mapped[str] = mapped_column(Text)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(String(500), default="")


class WorkbenchOperation(Base):
    __tablename__ = "agent_workbench_operations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("agent_workbench_sources.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(24), default="queued")
    message: Mapped[str] = mapped_column(String(500), default="等待扫描")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class WorkbenchChange(Base):
    __tablename__ = "agent_workbench_changes"
    __table_args__ = {"sqlite_autoincrement": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str | None] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
