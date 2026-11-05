from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base, external_id
from app.runtime.time import utc_now


class PresentationProject(Base):
    __tablename__ = "presentation_projects"
    __table_args__ = (
        Index("ix_presentation_projects_account_updated", "owner_user_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey(external_id("users"), ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    # Versioned scene JSON; 0101 upgrades document metadata without changing project revisions.
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
        ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), primary_key=True
    )
