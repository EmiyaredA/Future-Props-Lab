"""Tools-owned host queue; the Mac worker receives a sanitized lease."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.runtime.database.native_records import NativeJobFields
from studio.runtime.time import utc_now


class ToolsNativeBase(DeclarativeBase):
    pass


class ToolsNativeJob(NativeJobFields, ToolsNativeBase):
    __tablename__ = "tools_native_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)


class ToolsDownloadArtifact(ToolsNativeBase):
    __tablename__ = "tools_download_artifacts"
    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tools_native_jobs.id", ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    description: Mapped[dict] = mapped_column(JSON)
    library_asset: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ToolsNavigationImportReceipt(ToolsNativeBase):
    __tablename__ = "tools_navigation_import_receipts"
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
