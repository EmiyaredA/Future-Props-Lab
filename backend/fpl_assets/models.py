"""Assets-owned reference sets and idempotent transfer receipts."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.capabilities.asset_store.models import VisualAsset
from app.runtime.ids import new_id
from app.runtime.time import utc_now


class ReferenceBase(DeclarativeBase):
    pass


class AssetReferenceSet(ReferenceBase):
    __tablename__ = "asset_reference_sets"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "service_id", "resource_kind", "resource_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    service_id: Mapped[str] = mapped_column(String(64))
    resource_kind: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str] = mapped_column(String(128))
    resource_revision: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AssetReferencePin(ReferenceBase):
    __tablename__ = "asset_reference_pins"
    reference_set_id: Mapped[str] = mapped_column(
        ForeignKey("asset_reference_sets.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey(VisualAsset.__table__.c.id, ondelete="RESTRICT"), primary_key=True, index=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)


class AssetReferenceReceipt(ReferenceBase):
    __tablename__ = "asset_reference_receipts"
    __table_args__ = (UniqueConstraint("owner_user_id", "service_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    service_id: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(String(128))
    payload_sha256: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AssetDeletion(ReferenceBase):
    __tablename__ = "asset_file_deletions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    asset_id: Mapped[str] = mapped_column(String(36), unique=True)
    asset_snapshot: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
