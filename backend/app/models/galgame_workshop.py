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
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.ids import new_id
from app.core.time import utc_now
from app.models.base import Base


class GalgameWorkshopProject(Base):
    __tablename__ = "galgame_workshop_projects"
    __table_args__ = (
        Index(
            "ix_galgame_workshop_projects_updated_at",
            "updated_at",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class GalgameStoryDocument(Base):
    __tablename__ = "galgame_story_documents"

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("galgame_workshop_projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    document: Mapped[dict] = mapped_column(
        JSON,
        default=lambda: {
            "schemaVersion": "1.3",
            "synopsis": "",
            "characters": [],
            "scenes": [],
            "variables": [],
            "assets": [],
            "chapters": [
                {
                    "id": "chapter-1",
                    "title": "第一章",
                    "order": 1,
                    "entryFragmentId": "main",
                    "fragments": [{"id": "main", "title": "main", "blocks": []}],
                }
            ],
        },
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class GalgameProjectAssetReference(Base):
    __tablename__ = "galgame_project_asset_references"
    __table_args__ = (
        UniqueConstraint("project_id", "asset_id"),
        Index("ix_galgame_project_asset_references_asset", "asset_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("galgame_workshop_projects.id", ondelete="CASCADE"),
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GalgameAssetMetadata(Base):
    __tablename__ = "galgame_asset_metadata"
    __table_args__ = (
        Index("ix_galgame_asset_metadata_project_path", "project_id", "virtual_path"),
    )

    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galgame_workshop_projects.id", ondelete="CASCADE")
    )
    category: Mapped[str] = mapped_column(String(32), default="other")
    virtual_path: Mapped[str] = mapped_column(String(512))
    packaging_policy: Mapped[str] = mapped_column(String(16), default="auto")
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    transcript: Mapped[str | None] = mapped_column(Text)
    transcript_language: Mapped[str | None] = mapped_column(String(16))
    transcript_status: Mapped[str] = mapped_column(String(16), default="pending")
    transcript_source: Mapped[str | None] = mapped_column(String(16))
    transcript_revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class GalgameAssetSettings(Base):
    __tablename__ = "galgame_asset_settings"

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("galgame_workshop_projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    asr_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_entries.id", ondelete="SET NULL")
    )
    default_language: Mapped[str] = mapped_column(String(16), default="auto")
    concurrency: Mapped[int] = mapped_column(Integer, default=2)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class GalgameAssetTranscriptionTask(Base):
    __tablename__ = "galgame_asset_transcription_tasks"
    __table_args__ = (
        Index(
            "ix_galgame_asset_transcription_tasks_project_status",
            "project_id",
            "status",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galgame_workshop_projects.id", ondelete="CASCADE")
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_assets.id", ondelete="CASCADE")
    )
    provider_id: Mapped[str | None] = mapped_column(String(36))
    provider_name: Mapped[str] = mapped_column(String(120), default="")
    model_id: Mapped[str | None] = mapped_column(String(36))
    model_slug: Mapped[str] = mapped_column(String(160), default="")
    language: Mapped[str] = mapped_column(String(16), default="auto")
    force: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    result_text: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class GalgameStorySnapshot(Base):
    __tablename__ = "galgame_story_snapshots"
    __table_args__ = (
        Index("ix_galgame_story_snapshots_project_created", "project_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galgame_workshop_projects.id", ondelete="CASCADE")
    )
    story_revision: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
