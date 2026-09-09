from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class RuntimeAdmission(Base):
    __tablename__ = "runtime_admissions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"))
    platform_role: Mapped[str] = mapped_column(String(16))
    realtime_voice: Mapped[bool] = mapped_column(Boolean, default=False)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    task_kind: Mapped[str | None] = mapped_column(String(40), nullable=True)
    task_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
