"""Publication fences stay until a trusted target result is durably settled."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class CreativeInstallFence(Base):
    __tablename__ = "creative_install_fences"

    operation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("creative_install_operations.operation_id", ondelete="RESTRICT"),
        primary_key=True,
    )
    item_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("creative_items.id", ondelete="RESTRICT"),
        primary_key=True,
        index=True,
    )


class CreativeInstallCancellation(Base):
    __tablename__ = "creative_install_cancellations"

    operation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("creative_install_operations.operation_id", ondelete="RESTRICT"),
        primary_key=True,
    )
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
