from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base, external_id
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class AudioAnnotationProject(Base):
    __tablename__ = "audio_annotation_projects"
    __table_args__ = (
        Index(
            "ix_audio_annotation_projects_account_updated",
            "owner_user_id",
            "updated_at",
            "created_at",
        ),
        Index("ix_audio_annotation_projects_asset", "asset_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT")
    )
    title: Mapped[str] = mapped_column(String(120))
    duration_ms: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AudioAnnotationDocument(Base):
    __tablename__ = "audio_annotation_documents"

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("audio_annotation_projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    schema_version: Mapped[str] = mapped_column(String(16), default="1.0")
    speakers: Mapped[list[dict]] = mapped_column(JSON, default=list)
    custom_emotions: Mapped[list[dict]] = mapped_column(JSON, default=list)
    segments: Mapped[list[dict]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AudioAnnotationWaveform(Base):
    __tablename__ = "audio_annotation_waveforms"

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("audio_annotation_projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    duration_ms: Mapped[int] = mapped_column(Integer)
    peaks: Mapped[list[list[float]]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
