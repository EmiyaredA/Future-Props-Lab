"""Models-owned provider dispatch, separate from the Visual project task."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.time import utc_now

from .orm import ModelsBase


class VisualProviderBatch(ModelsBase):
    __tablename__ = "model_visual_provider_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(128))
    plan_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16))
    source_path: Mapped[str | None] = mapped_column(Text)
    source_assertion: Mapped[str | None] = mapped_column(Text)
    input_key: Mapped[str | None] = mapped_column(String(64))
    input_assets: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class VisualProviderTask(ModelsBase):
    __tablename__ = "model_visual_provider_tasks"
    __table_args__ = (
        Index("ix_model_visual_provider_tasks_state", "status", "updated_at"),
        Index("ix_model_visual_provider_tasks_plan", "batch_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36))
    batch_id: Mapped[str] = mapped_column(
        ForeignKey(VisualProviderBatch.__table__.c.id, ondelete="RESTRICT")
    )
    provider_id: Mapped[str] = mapped_column(String(36))
    model_id: Mapped[str] = mapped_column(String(36))
    provider_kind: Mapped[str] = mapped_column(String(24))
    model_slug: Mapped[str] = mapped_column(String(160))
    generation_kind: Mapped[str] = mapped_column(String(16))
    request_payload: Mapped[dict] = mapped_column(JSON)
    provider_task_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="prepared")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    execution_info: Mapped[dict | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    result_url: Mapped[str | None] = mapped_column(Text)
    result_metadata: Mapped[dict | None] = mapped_column(JSON)
    last_retry_revision: Mapped[int | None] = mapped_column(Integer)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
