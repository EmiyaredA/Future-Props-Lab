"""The Models half of fixed synthetic-tool installation coordination."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.apps.model_service.orm import ModelsBase
from studio.runtime.time import utc_now


class DemoInstallation(ModelsBase):
    __tablename__ = "model_demo_installations"
    __table_args__ = (UniqueConstraint("owner_user_id", "expected_revision"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    expected_revision: Mapped[int] = mapped_column(Integer)
    intent_id: Mapped[str] = mapped_column(String(36), unique=True)
    audit: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
