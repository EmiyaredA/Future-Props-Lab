"""Video Editor's durable cross-service outcomes."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.runtime.time import utc_now
from fpl_runtime.reference_records import ReferenceMutationFields


class VideoServiceBase(DeclarativeBase):
    pass


class VideoReferenceMutation(ReferenceMutationFields, VideoServiceBase):
    __tablename__ = "video_reference_mutations"


class VideoAssetIntake(VideoServiceBase):
    __tablename__ = "video_asset_intakes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(36))
    target_path: Mapped[str] = mapped_column(String(512))
    assertion: Mapped[str] = mapped_column(Text)
    expected_count: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(16), default="pending")
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VideoMediaDispatch(VideoServiceBase):
    __tablename__ = "video_media_dispatches"

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(36))
    asset_id: Mapped[str] = mapped_column(String(36))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VideoRenderDispatch(VideoServiceBase):
    __tablename__ = "video_render_dispatches"

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(36))
    frozen: Mapped[dict] = mapped_column(JSON)
    settled: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
