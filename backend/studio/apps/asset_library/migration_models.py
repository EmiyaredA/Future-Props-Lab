"""Scoped receipt mapping used only by the Assets maintenance application."""

from sqlalchemy import JSON, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class AssetMaintenanceBase(DeclarativeBase):
    pass


class AssetImportReceipt(AssetMaintenanceBase):
    __tablename__ = "asset_import_receipts"

    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)


class AssetVideoOutputHistory(AssetMaintenanceBase):
    """Original task IDs for migration receipts reconstructed from legacy assets."""

    __tablename__ = "asset_video_output_history"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    record: Mapped[dict] = mapped_column(JSON)


MIGRATION_MODELS = (AssetImportReceipt, AssetVideoOutputHistory)
