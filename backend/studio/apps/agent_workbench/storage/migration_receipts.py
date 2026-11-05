"""Workbench-owned receipts for idempotent, account-scoped history imports."""

from studio.apps.agent_workbench.storage.service_models import NativeBase
from studio.runtime.database.migration_receipts import ImportReceiptFields


class AgentsImportReceipt(ImportReceiptFields, NativeBase):
    __tablename__ = "agents_import_receipts"
