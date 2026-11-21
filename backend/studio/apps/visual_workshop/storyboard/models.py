"""Owned storyboard document; all references stay inside the owning project/account."""

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base


class VisualStoryboard(Base):
    __tablename__ = "visual_storyboards"

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"), primary_key=True
    )
    shots: Mapped[list[dict]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
