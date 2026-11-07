"""Preserve owned inference task state and its exact input and output associations."""

from datetime import datetime
from typing import Literal

from pydantic import Field, JsonValue, TypeAdapter, ValidationError, model_validator
from sqlalchemy import select

from studio.apps.model_service.storage.migration_originals import OutputKey, StorageKey
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.contracts.model_service.task_execution import TaskExecutionInfo
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

IDENTIFIERS = TypeAdapter(list[Identifier])


class InferenceTask(HistoryRecord):
    id: Identifier
    # Legacy internal submissions could exceed the public request limit.
    request_id: str = Field(min_length=1, max_length=128)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    provider_id: Identifier | None
    model_id: Identifier | None
    provider_kind: str
    provider_name: str
    model_slug: str
    kind: Literal["image", "video", "music", "sound_effect", "transcription", "speech_synthesis"]
    request_payload: dict[str, JsonValue] = Field(repr=False)
    status: Literal[
        "queued", "submitting", "pending", "processing", "running", "completed", "failed"
    ]
    progress: int = Field(ge=0, le=100)
    execution_info: dict[str, JsonValue] | None
    provider_task_id: str = Field(repr=False)
    result_url: str = Field(repr=False)
    result_storage_key: OutputKey | Literal[""]
    result_filename: str
    result_mime_type: str
    result_byte_size: int = Field(ge=0)
    result: dict[str, JsonValue] = Field(repr=False)
    error_message: str | None = Field(repr=False)
    auth_kind: str | None
    api_key_id: str | None
    api_key_name: str | None
    api_key_prefix: str | None
    log_id: Identifier | None
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def verify_result(self):
        if bool(self.result_storage_key) != bool(self.result_byte_size):
            raise ValueError("调用任务输出文件记录不完整")
        if self.execution_info is not None:
            TaskExecutionInfo.model_validate(self.execution_info)
        return self


class InferenceAsset(HistoryRecord):
    id: Identifier
    task_id: Identifier | None
    storage_key: StorageKey
    filename: str
    mime_type: str
    media_kind: Literal["audio", "image", "video"]
    byte_size: int = Field(gt=0)
    created_at: datetime


class InferenceTasks(MigrationBatch[InferenceTask]):
    dataset: Literal["models.inference-tasks"]


class InferenceAssets(MigrationBatch[InferenceAsset]):
    dataset: Literal["models.inference-assets"]


async def validate_model_links(session, item, *, domain="inference"):
    owner = session.info["owner_user_id"]
    if item.provider_id:
        provider = await session.get(ModelProvider, item.provider_id)
        if provider is None or provider.owner_user_id != owner:
            raise blocked(f"migration_{domain}_provider_conflict")
    if item.model_id:
        model = await session.get(ModelEntry, item.model_id)
        if model is None or (model.owner_user_id, model.provider_id) != (owner, item.provider_id):
            raise blocked(f"migration_{domain}_model_conflict")
    if item.log_id:
        # Logs can be removed independently by their owner. Reject an existing
        # log under a different account while retaining a historical deleted ID.
        logs = LlmCallLog.__table__.c
        actual = await session.scalar(select(logs.owner_user_id).where(logs.id == item.log_id))
        if actual is not None and actual != owner:
            raise blocked(f"migration_{domain}_log_conflict")


async def validate_asset(session, item):
    if item.task_id:
        task = await session.get(ModelInferenceTask, item.task_id)
        if task is None or task.owner_user_id != session.info["owner_user_id"]:
            raise blocked("migration_inference_asset_task_conflict")


def referenced_inputs(payload):
    ids = set()
    try:
        for field, value in payload.items():
            if value and field.endswith("asset_ids"):
                ids.update(IDENTIFIERS.validate_python(value))
            if value and field.endswith("asset_id"):
                ids.update(IDENTIFIERS.validate_python([value]))
    except ValidationError:
        raise blocked("migration_inference_inputs_invalid") from None
    return ids


async def verify_inputs(sessions):
    tasks = ModelInferenceTask
    assets = ModelInferenceAsset
    async with sessions(info={"allow_system_reads": True}) as session:
        rows = await session.stream(
            select(
                tasks.id,
                tasks.owner_user_id,
                tasks.request_payload,
                assets.id,
                assets.owner_user_id,
            )
            .outerjoin(assets, assets.task_id == tasks.id)
            .order_by(tasks.id, assets.id)
        )
        count, identity, claimed, expected = 0, None, set(), set()
        async for task_id, owner, payload, asset_id, asset_owner in rows:
            if identity != task_id:
                if not expected <= claimed:
                    raise blocked("migration_inference_inputs_missing")
                count += 1
                identity, claimed, expected = task_id, set(), referenced_inputs(payload)
            if asset_id is not None:
                if owner != asset_owner:
                    raise blocked("migration_inference_asset_task_conflict")
                claimed.add(asset_id)
        if not expected <= claimed:
            raise blocked("migration_inference_inputs_missing")
    return {"record_count": count}


DATASETS = (
    ProjectDataset(
        "models.inference-tasks",
        ModelInferenceTask,
        InferenceTask,
        InferenceTasks,
        MigrationPage[InferenceTasks],
        validate=validate_model_links,
    ),
    ProjectDataset(
        "models.inference-assets",
        ModelInferenceAsset,
        InferenceAsset,
        InferenceAssets,
        MigrationPage[InferenceAssets],
        page_size=64,
        validate=validate_asset,
    ),
)
