from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class ModelSupplier(Base):
    __tablename__ = "model_suppliers"
    __table_args__ = (UniqueConstraint("owner_user_id", "template_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    origin: Mapped[str] = mapped_column(String(24), default="user")
    template_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
