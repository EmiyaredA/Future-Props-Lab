from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class PresentationProject(Base):
    __tablename__ = "presentation_projects"
    __table_args__ = (
        Index("ix_presentation_projects_workspace_updated", "workspace_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    document: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class PresentationAssetReference(Base):
    __tablename__ = "presentation_asset_references"
    __table_args__ = (Index("ix_presentation_asset_references_asset", "asset_id"),)

    project_id: Mapped[str] = mapped_column(
        ForeignKey("presentation_projects.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="RESTRICT"), primary_key=True
    )
