"""Platform settings and registration records; business rules live in accounts."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class PlatformSetting(Base):
    __tablename__ = "platform_settings"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class RegistrationInviteCode(Base):
    __tablename__ = "registration_invite_codes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    code_hint: Mapped[str] = mapped_column(String(40))
    secret_ciphertext: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    max_uses: Mapped[int] = mapped_column(Integer)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    validity_days: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class RegistrationRedemption(Base):
    __tablename__ = "registration_redemptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    invite_id: Mapped[str] = mapped_column(ForeignKey("registration_invite_codes.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
