"""Remote's durable cloud setup decisions and Mac receipts."""

from sqlalchemy import JSON, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.runtime.database.native_records import NativeJobFields


class RemoteSetupBase(DeclarativeBase):
    pass


class RemoteSetupJob(NativeJobFields, RemoteSetupBase):
    __tablename__ = "remote_setup_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)


class RemoteMaintenanceBase(DeclarativeBase):
    pass


class DesktopPreferenceImportReceipt(RemoteMaintenanceBase):
    __tablename__ = "remote_desktop_import_receipts"
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)
