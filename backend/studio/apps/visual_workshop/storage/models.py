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
)
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base, external_id
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class VisualWorkshopProject(Base):
    is_official: Mapped[bool] = mapped_column(Boolean, default=False)
    __tablename__ = "visual_workshop_projects"
    __table_args__ = (
        Index(
            "ix_visual_workshop_projects_updated_at",
            "updated_at",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
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
    edges: Mapped[list[dict]] = mapped_column(JSON, default=list)
    categories: Mapped[list[dict]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VisualGenerationTask(Base):
    __tablename__ = "visual_generation_tasks"
    __table_args__ = (
        Index("ix_visual_generation_tasks_project_created", "project_id", "created_at"),
        Index(
            "ix_visual_generation_tasks_project_canvas_node_created",
            "project_id",
            "canvas_node_id",
            "created_at",
        ),
        Index("ix_visual_generation_tasks_status_updated", "status", "updated_at"),
        Index("ix_visual_generation_tasks_provider", "provider_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    # Legacy SQLite constraints remain in its registered migrations.
    # The owned schema carries these Models and Assets identifiers across API boundaries.
    provider_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("model_providers"), ondelete="SET NULL")
    )
    model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("model_entries"), ondelete="SET NULL")
    )
    provider_kind: Mapped[str] = mapped_column(String(24))
    generation_kind: Mapped[str] = mapped_column(String(16))
    provider_name: Mapped[str] = mapped_column(String(120))
    model_slug: Mapped[str] = mapped_column(String(160))
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    canvas_node_id: Mapped[str | None] = mapped_column(String(64), index=False)
    provider_task_id: Mapped[str | None] = mapped_column(String(255))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    execution_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    result_url: Mapped[str | None] = mapped_column(Text)
    result_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class VisualGenerationBatch(Base):
    __tablename__ = "visual_generation_batches"
    __table_args__ = (
        Index("ix_visual_generation_batches_project_created", "project_id", "created_at"),
        Index("ix_visual_generation_batches_status_updated", "status", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    batch_kind: Mapped[str] = mapped_column(String(16), default="generation")
    grid_size: Mapped[int] = mapped_column(Integer)
    grid_output: Mapped[str] = mapped_column(String(16), default="nodes")
    child_task_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_items: Mapped[list[dict]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    completed_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_count: Mapped[int] = mapped_column(Integer, default=0)
    result_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="SET NULL")
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    generation_node_id: Mapped[str | None] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
