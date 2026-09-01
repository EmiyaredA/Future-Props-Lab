from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class VideoEditorProject(Base):
    __tablename__ = "video_editor_projects"
    __table_args__ = (
        Index("ix_video_editor_projects_workspace_updated", "workspace_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    title: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    source_application: Mapped[str | None] = mapped_column(String(32))
    source_project_id: Mapped[str | None] = mapped_column(String(36))
    source_revision: Mapped[int | None] = mapped_column(Integer)
    source_compiler_version: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VideoEditorTimeline(Base):
    __tablename__ = "video_editor_timelines"

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("video_editor_projects.id", ondelete="CASCADE"), primary_key=True
    )
    document: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VideoEditorOperationBatch(Base):
    __tablename__ = "video_editor_operation_batches"
    __table_args__ = (
        UniqueConstraint("project_id", "request_id", name="uq_video_editor_operation_request"),
        Index("ix_video_editor_operation_project_created", "project_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("video_editor_projects.id", ondelete="CASCADE")
    )
    request_id: Mapped[str] = mapped_column(String(64))
    base_revision: Mapped[int] = mapped_column(Integer)
    result_revision: Mapped[int] = mapped_column(Integer)
    operations: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VideoEditorAssetMetadata(Base):
    __tablename__ = "video_editor_asset_metadata"
    __table_args__ = (Index("ix_video_editor_asset_project", "project_id", "created_at"),)

    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("video_editor_projects.id", ondelete="CASCADE")
    )
    processing_status: Mapped[str] = mapped_column(String(16), default="queued")
    probe: Mapped[dict] = mapped_column(JSON, default=dict)
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    proxy_filename: Mapped[str | None] = mapped_column(String(255))
    thumbnail_filename: Mapped[str | None] = mapped_column(String(255))
    waveform_filename: Mapped[str | None] = mapped_column(String(255))
    error: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class VideoEditorTask(Base):
    __tablename__ = "video_editor_tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "request_id", name="uq_video_editor_task_request"),
        Index("ix_video_editor_tasks_status_created", "status", "created_at"),
        Index("ix_video_editor_tasks_project_created", "project_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("video_editor_projects.id", ondelete="CASCADE")
    )
    request_id: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    snapshot_document: Mapped[dict] = mapped_column(JSON, default=dict)
    result_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    output_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="SET NULL")
    )
    error: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
