"""Standalone records with no cross-application foreign keys."""

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class SpreadsheetBase(DeclarativeBase):
    pass


class SpreadsheetWorkbook(SpreadsheetBase):
    __tablename__ = "spreadsheet_workbooks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(120))
    document: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    calculation: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))
    source_key: Mapped[str | None] = mapped_column(String(64))
    source_name: Mapped[str | None] = mapped_column(String(255))


class SpreadsheetReceipt(SpreadsheetBase):
    __tablename__ = "spreadsheet_receipts"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    resource_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)


class SpreadsheetImport(SpreadsheetBase):
    __tablename__ = "spreadsheet_imports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    sha256: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(String(255))
    source_key: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict] = mapped_column(JSON)
    warnings: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(Text)


MODELS = (SpreadsheetWorkbook, SpreadsheetReceipt, SpreadsheetImport)
