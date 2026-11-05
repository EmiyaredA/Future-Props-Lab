"""Receipts for the three fixed synthetic account tools."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.time import utc_now

from .orm import IntegrationsBase


class DemoToolInstallation(IntegrationsBase):
    __tablename__ = "integration_demo_tool_installations"
    intent_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
