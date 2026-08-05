from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.models.base import Base
from app.models.model_service import new_id


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
            "schemaVersion": "1.0",
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
