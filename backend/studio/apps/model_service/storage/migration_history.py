"""Transfer account-owned model call history before importing tasks linked to it."""

from datetime import datetime
from typing import Literal

from pydantic import Field, JsonValue

from studio.apps.model_service.storage.migration_inference import DATASETS as INFERENCE
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


DATASETS = (
    ProjectDataset("models.call-logs", LlmCallLog, Call, Calls, MigrationPage[Calls]),
    *INFERENCE,
)
