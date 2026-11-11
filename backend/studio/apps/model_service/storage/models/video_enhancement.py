from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class VideoEnhancementTask(Base):
    __tablename__ = "video_enhancement_tasks"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "request_id"),
        Index("ix_video_enhancement_owner", "owner_user_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    request_id: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[str] = mapped_column(
        ForeignKey("model_inference_assets.id", ondelete="CASCADE")
    )
    model_id: Mapped[str] = mapped_column(String(36))
    model_revision: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="queued")
    video: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    segments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    completed: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
