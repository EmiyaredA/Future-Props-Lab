"""Revisioned links are owned by the project, not the reusable account card."""

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base


class VisualCreationLinks(Base):
    __tablename__ = "visual_creation_links"
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"), primary_key=True
    )
    scenes: Mapped[list[dict]] = mapped_column(JSON, default=list)
    objects: Mapped[list[dict]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
