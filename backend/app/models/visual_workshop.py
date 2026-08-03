from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.models.base import Base
from app.models.model_service import new_id


class VisualWorkshopProject(Base):
    __tablename__ = "visual_workshop_projects"
    __table_args__ = (
        Index(
            "ix_visual_workshop_projects_updated_at",
            "updated_at",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
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
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualAssetFolder(Base):
    __tablename__ = "visual_asset_folders"
    __table_args__ = (
        Index("ix_visual_asset_folders_project_parent", "project_id", "parent_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
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
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    folder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_asset_folders.id", ondelete="CASCADE")
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
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


class VisualGenerationTask(Base):
    __tablename__ = "visual_generation_tasks"
    __table_args__ = (
        Index("ix_visual_generation_tasks_project_created", "project_id", "created_at"),
        Index("ix_visual_generation_tasks_status_updated", "status", "updated_at"),
        Index("ix_visual_generation_tasks_provider", "provider_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
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
    provider_task_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    result_url: Mapped[str | None] = mapped_column(Text)
    result_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
