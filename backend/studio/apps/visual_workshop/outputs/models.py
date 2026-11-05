from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base, external_id
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class VisualNodeOutput(Base):
    __tablename__ = "visual_node_outputs"
    __table_args__ = (
        UniqueConstraint("project_id", "node_id", "version"),
        UniqueConstraint("project_id", "source_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT")
    )
    inspection_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT")
    )
    text: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16))
    source_key: Mapped[str] = mapped_column(String(160))
    generation_task_id: Mapped[str | None] = mapped_column(String(36))
    input_snapshot: Mapped[list[dict]] = mapped_column(JSON, default=list)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
