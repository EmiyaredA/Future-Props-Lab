from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now

DEFAULT_WORKSPACE_ID = "default"


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255))
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


__all__ = ["DEFAULT_WORKSPACE_ID", "Workspace"]
