"""Owner-side lease records for native Interview execution."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base


class InterviewNativeLease(Base):
    __tablename__ = "interview_native_leases"

    task_id: Mapped[str] = mapped_column(
        ForeignKey("interview_preparations.id", ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    worker_id: Mapped[str] = mapped_column(String(100))
    lease_id: Mapped[str] = mapped_column(String(36), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    outcome_sha256: Mapped[str | None] = mapped_column(String(64))
