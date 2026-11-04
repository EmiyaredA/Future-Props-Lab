"""Remote-owned receipts for verified desktop preference import."""

from sqlalchemy import JSON, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class RemoteMaintenanceBase(DeclarativeBase):
    pass


class DesktopPreferenceImportReceipt(RemoteMaintenanceBase):
    __tablename__ = "remote_desktop_import_receipts"
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)
