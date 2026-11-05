"""Owner-local execution plans for node acceptance runs."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.apps.visual_workshop.acceptance.models import AcceptanceRun
from app.runtime.time import utc_now


class ReviewDispatchBase(DeclarativeBase):
    pass


class VisualReviewDispatch(ReviewDispatchBase):
    __tablename__ = "visual_review_dispatches"

    run_id: Mapped[str] = mapped_column(
        ForeignKey(AcceptanceRun.__table__.c.id, ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36))
    assertion: Mapped[str] = mapped_column(Text)
    source_path: Mapped[str] = mapped_column(Text)
    executor: Mapped[dict] = mapped_column(JSON)
    retention_receipt: Mapped[str] = mapped_column(String(128))
    checked_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=utc_now)
