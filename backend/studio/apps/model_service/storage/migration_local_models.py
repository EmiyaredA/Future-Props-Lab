"""Transfer deployment-wide Mac model state and original command receipts."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, ValidationError
from sqlalchemy import func, literal

from studio.apps.model_service.storage.models.local_models import (
    LocalModelInstallation,
    LocalModelOperation,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord
from studio.contracts.model_service.schemas.local_models import LocalModelOut
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

MODEL_ID = r"[a-z0-9][a-z0-9.-]{0,63}"
ModelId = Annotated[str, Field(pattern=f"^{MODEL_ID}$")]


class Installation(HistoryRecord):
    id: ModelId
    status: Literal["not_installed", "installing", "installed", "failed", "cancelled"]
    enabled: bool
    progress: int = Field(ge=0, le=100)
    error_message: str | None
    revision: int = Field(ge=0)
    updated_at: datetime


class Operation(HistoryRecord):
    model_id: ModelId
    request_id: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    result: dict
    created_at: datetime

    @property
    def id(self):
        return f"{self.model_id}:{self.request_id.encode().hex().upper()}"


class ReceiptError(HistoryRecord):
    message: str
    code: str
    status: int = Field(ge=400, le=599)


class Failure(HistoryRecord):
    error: ReceiptError


class Installations(MigrationBatch[Installation]):
    dataset: Literal["models.local-installations"]


class Operations(MigrationBatch[Operation]):
    dataset: Literal["models.local-operations"]


class OperationDataset(ProjectDataset):
    def key_for(self, record):
        if record is self.model:
            return self.model.model_id + literal(":") + func.hex(self.model.request_id)
        return record.id


async def verify_operation(session, item):
    installation = await session.get(LocalModelInstallation, item.model_id)
    if installation is None:
        raise blocked("migration_local_model_receipt_unassigned")
    try:
        if "error" in item.result:
            Failure.model_validate(item.result)
        else:
            snapshot = LocalModelOut.model_validate(item.result)
            if snapshot.id != item.model_id or snapshot.revision > installation.revision:
                raise blocked("migration_local_model_receipt_conflict")
    except ValidationError:
        raise blocked("migration_local_model_receipt_invalid") from None


DATASETS = (
    ProjectDataset(
        "models.local-installations",
        LocalModelInstallation,
        Installation,
        Installations,
        MigrationPage[Installations],
        cursor_pattern=f"^{MODEL_ID}$",
        platform=True,
    ),
    OperationDataset(
        "models.local-operations",
        LocalModelOperation,
        Operation,
        Operations,
        MigrationPage[Operations],
        cursor_pattern=rf"^{MODEL_ID}:[0-9A-F]{{2,512}}$",
        platform=True,
        page_size=32,
        validate=verify_operation,
    ),
)
