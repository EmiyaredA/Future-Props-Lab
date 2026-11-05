"""Gateway-owned notification cursors and deduplicated application events."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.runtime.time import utc_now


class GatewayBase(DeclarativeBase):
    pass


class ChangeCursor(GatewayBase):
    __tablename__ = "gateway_change_cursors"
    owner_user_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ChangeReceipt(GatewayBase):
    __tablename__ = "gateway_change_receipts"
    service_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(100), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
