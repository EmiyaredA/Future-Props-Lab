"""Durable same-account uploads retain staging until a confirmed receipt."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base
from studio.runtime.time import utc_now


class ThoughtUploadIntent(Base):
    __tablename__ = "thought_upload_intents"

    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    descriptor_sha256: Mapped[str] = mapped_column(String(64))
    descriptor: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), default="staged")
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
