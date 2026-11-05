"""Durable receipts for the Thought maintenance receiver."""

from sqlalchemy.orm import DeclarativeBase

from studio.runtime.database.migration_receipts import ImportReceiptFields


class MigrationBase(DeclarativeBase):
    pass


class ThoughtImportReceipt(ImportReceiptFields, MigrationBase):
    __tablename__ = "thought_import_receipts"
