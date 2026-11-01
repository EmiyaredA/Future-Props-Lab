"""Durable roots for the one-time account storage upgrade."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base


class AccountStorageUpgradeRoot(Base):
    __tablename__ = "account_storage_upgrade_roots"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    source_relative_root: Mapped[str] = mapped_column(Text)
    target_relative_root: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="pending")
    error: Mapped[str] = mapped_column(Text, default="")
