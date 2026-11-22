"""Assets-owned derived fingerprints and durable cleanup decisions."""

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base
from studio.runtime.time import utc_now


class AssetContentFingerprint(Base):
    __tablename__ = "asset_content_fingerprints"
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    descriptor: Mapped[dict] = mapped_column(JSON)
    sha256: Mapped[str] = mapped_column(String(64), index=True)


class AssetDedupeOperation(Base):
    __tablename__ = "asset_dedupe_operations"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(80))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[object] = mapped_column(DateTime, default=utc_now)

