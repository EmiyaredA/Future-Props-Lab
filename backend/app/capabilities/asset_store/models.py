from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class VisualAssetFolder(Base):
    __tablename__ = "visual_asset_folders"
    __table_args__ = (
        Index("ix_visual_asset_folders_project_parent", "project_id", "parent_id", "created_at"),
        Index(
            "ux_visual_asset_folders_scope_parent_name",
            "owner_user_id",
            text("ifnull(project_id, '')"),
            text("ifnull(parent_id, '')"),
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str | None] = mapped_column(String(36))
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_asset_folders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(120))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualAsset(Base):
    __tablename__ = "visual_assets"
    __table_args__ = (
        Index(
            "ix_visual_assets_project_folder_updated",
            "project_id",
            "folder_id",
            "updated_at",
            "created_at",
        ),
        Index("ix_visual_assets_video_editor_project", "video_editor_project_id", "updated_at"),
        Index("ix_visual_assets_motion_project", "motion_compositor_project_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str | None] = mapped_column(String(36))
    galgame_project_id: Mapped[str | None] = mapped_column(String(36))
    video_editor_project_id: Mapped[str | None] = mapped_column(String(36))
    motion_compositor_project_id: Mapped[str | None] = mapped_column(String(36))
    folder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_asset_folders.id", ondelete="CASCADE")
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    storage_version: Mapped[int] = mapped_column(Integer, default=1)
    media_kind: Mapped[str] = mapped_column(String(16))
    mime_type: Mapped[str] = mapped_column(String(120))
    byte_size: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualProjectAssetReference(Base):
    __tablename__ = "visual_project_asset_references"
    __table_args__ = (
        Index(
            "ix_visual_project_asset_references_folder",
            "project_id",
            "folder_id",
            "updated_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="RESTRICT")
    )
    folder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_asset_folders.id", ondelete="CASCADE")
    )
    display_name: Mapped[str] = mapped_column(String(255))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
