from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class ToolNavigationItem(Base):
    __tablename__ = "tool_navigation_items"

    workspace_id: Mapped[str] = mapped_column(String(36), primary_key=True, default="default")
    tool_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    favorite_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
