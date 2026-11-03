"""Owned immutable Creative installation and component receipts."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.time import utc_now

from .orm import IntegrationsBase


class CreativeInstallReceipt(IntegrationsBase):
    __tablename__ = "integration_creative_install_receipts"
    __table_args__ = (UniqueConstraint("owner_user_id", "operation_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    operation_id: Mapped[str] = mapped_column(String(100))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class CreativeInstalledPart(IntegrationsBase):
    __tablename__ = "integration_creative_installed_parts"
    __table_args__ = (UniqueConstraint("owner_user_id", "release_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    release_id: Mapped[str] = mapped_column(String(100))
    fingerprint: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(500), default="")
    result: Mapped[dict] = mapped_column(JSON)
    setup_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
