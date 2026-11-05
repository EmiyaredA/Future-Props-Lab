"""Visual-owned reference metadata; external asset and folder IDs are opaque."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


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
    asset_id: Mapped[str] = mapped_column(String(36))
    folder_id: Mapped[str | None] = mapped_column(String(36))
    display_name: Mapped[str] = mapped_column(String(255))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
