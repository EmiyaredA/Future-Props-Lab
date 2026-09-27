from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class CreativeItem(Base):
    __tablename__ = "creative_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    origin_workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    author_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    title: Mapped[str] = mapped_column(String(120), default="")
    summary: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    cover_preset: Mapped[str] = mapped_column(String(32), default="sunrise")
    draft_manifest: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    draft_components: Mapped[list[str]] = mapped_column(JSON, default=list)
    draft_cover_path: Mapped[str] = mapped_column(String(1024), default="")
    draft_skill_path: Mapped[str] = mapped_column(String(1024), default="")
    current_release_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class CreativeRelease(Base):
    __tablename__ = "creative_releases"
    __table_args__ = (UniqueConstraint("item_id", "version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("creative_items.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    cover_preset: Mapped[str] = mapped_column(String(32), default="sunrise")
    cover_path: Mapped[str] = mapped_column(String(1024), default="")
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    components: Mapped[list[str]] = mapped_column(JSON, default=list)
    skill_path: Mapped[str] = mapped_column(String(1024), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class CreativeInstallation(Base):
    __tablename__ = "creative_installations"
    __table_args__ = (UniqueConstraint("workspace_id", "release_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    release_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("creative_releases.id", ondelete="RESTRICT"), index=True
    )
    installed_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )
    resources: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
