"""Private durable coordination records for Creative installations."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base
from studio.runtime.time import utc_now


class CreativeInstallOperation(Base):
    __tablename__ = "creative_install_operations"
    __table_args__ = (UniqueConstraint("owner_user_id", "root_release_id"),)

    operation_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    root_release_id: Mapped[str] = mapped_column(String(36))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    batch_fingerprint: Mapped[str] = mapped_column(String(64))
    batch: Mapped[dict[str, Any]] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="pending")
    receipt: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
