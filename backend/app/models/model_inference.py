from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class ModelInferenceTask(Base):
    __tablename__ = "model_inference_tasks"
    __table_args__ = (
        UniqueConstraint("workspace_id", "request_id"),
        Index("ix_model_inference_tasks_workspace_status", "workspace_id", "status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    request_id: Mapped[str] = mapped_column(String(64))
    fingerprint: Mapped[str] = mapped_column(String(64))
    provider_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_providers.id", ondelete="SET NULL")
    )
    model_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_entries.id", ondelete="SET NULL")
    )
    provider_kind: Mapped[str] = mapped_column(String(40))
    provider_name: Mapped[str] = mapped_column(String(160))
    model_slug: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(24))
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    provider_task_id: Mapped[str] = mapped_column(Text, default="")
    result_url: Mapped[str] = mapped_column(Text, default="")
    result_storage_key: Mapped[str] = mapped_column(String(64), default="")
    result_filename: Mapped[str] = mapped_column(String(255), default="")
    result_mime_type: Mapped[str] = mapped_column(String(120), default="")
    result_byte_size: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    auth_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    api_key_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    api_key_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_key_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True)
    log_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ModelInferenceAsset(Base):
    __tablename__ = "model_inference_assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_inference_tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120))
    media_kind: Mapped[str] = mapped_column(String(24))
    byte_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
