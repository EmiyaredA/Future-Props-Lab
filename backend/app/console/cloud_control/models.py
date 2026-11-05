from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base


class CloudFactor(Base):
    __tablename__ = "cloud_control_factors"

    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    secret: Mapped[str | None]
    pending_secret: Mapped[str | None]
    pending_until: Mapped[int]
    last_counter: Mapped[int]
    attempts: Mapped[int]
    attempt_window: Mapped[int]


class CloudUnlock(Base):
    __tablename__ = "cloud_control_unlocks"

    session_id: Mapped[str] = mapped_column(ForeignKey("auth_sessions.id"), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[int]
    ticket_hash: Mapped[str | None]
    ticket_until: Mapped[int]
    desktop_verified: Mapped[bool] = mapped_column(default=False)
