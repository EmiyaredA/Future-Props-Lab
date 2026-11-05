"""Transfer account-owned model call history before importing tasks linked to it."""

from datetime import datetime
from typing import Literal

from pydantic import Field, JsonValue

from studio.apps.model_service.storage.migration_governance import DATASETS as GOVERNANCE
from studio.apps.model_service.storage.migration_governance import bind_governance
from studio.apps.model_service.storage.migration_inference import DATASETS as INFERENCE
from studio.apps.model_service.storage.migration_local_models import DATASETS as LOCAL_MODELS
from studio.apps.model_service.storage.migration_playground import DATASETS as PLAYGROUND
from studio.apps.model_service.storage.migration_playground_tasks import DATASETS as TEST_TASKS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import ProjectDataset


class Call(HistoryRecord):
    id: Identifier
    call_source: str
    provider_kind: str
    model: str
    auth_kind: str | None
    api_key_id: str | None
    api_key_name: str | None
    api_key_prefix: str | None
    trace_id: str
    request_payload: dict[str, JsonValue] = Field(repr=False)
    response_payload: dict[str, JsonValue] = Field(repr=False)
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int
    status: str
    error_message: str | None = Field(repr=False)
    created_at: datetime


class Calls(MigrationBatch[Call]):
    dataset: Literal["models.call-logs"]


OWNED_HISTORY = (
    ProjectDataset("models.call-logs", LlmCallLog, Call, Calls, MigrationPage[Calls]),
    *INFERENCE,
    *PLAYGROUND,
    *TEST_TASKS,
)
DATASETS = (*OWNED_HISTORY, *GOVERNANCE, *LOCAL_MODELS)


def maintenance_datasets(plan, *, legacy, cipher):
    return (*OWNED_HISTORY, *bind_governance(plan, legacy=legacy, cipher=cipher), *LOCAL_MODELS)
