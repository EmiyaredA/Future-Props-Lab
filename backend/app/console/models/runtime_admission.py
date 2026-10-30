from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


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
    waiting: Mapped[bool] = mapped_column(Boolean, default=False)
    queue_task_id: Mapped[str | None] = mapped_column(
        ForeignKey("visual_generation_tasks.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
