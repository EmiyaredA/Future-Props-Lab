"""Preserve model testing generation and transcription tasks and their recorded inputs."""

from datetime import datetime
from functools import partial
from typing import Literal

from pydantic import Field, JsonValue, ValidationError, model_validator
from sqlalchemy import select

from studio.apps.model_service.playground.generation_assets import ROLE_FIELDS, reference_ids
from studio.apps.model_service.storage.migration_inference import IDENTIFIERS, validate_model_links
from studio.apps.model_service.storage.migration_originals import StorageKey
from studio.apps.model_service.storage.models.model_test import (
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestTranscriptionTask,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.contracts.model_service.schemas.model_test import (
    GenerationTaskStatus,
    TranscriptionTaskStatus,
)
from studio.contracts.model_service.task_execution import TaskExecutionInfo
from studio.runtime.database.project_history_migration import ProjectDataset, blocked


class Task(HistoryRecord):
    id: Identifier
    provider_id: Identifier | None
    model_id: Identifier | None
    provider_kind: str
    provider_name: str
    model_slug: str
    auth_kind: str | None
    api_key_id: str | None
    api_key_name: str | None
    api_key_prefix: str | None
    log_id: Identifier | None
    revision: int = Field(ge=0)
    error_message: str | None = Field(repr=False)
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class Generation(Task):
    generation_kind: Literal["image", "video"]
    request_payload: dict[str, JsonValue] = Field(repr=False)
    provider_task_id: str | None = Field(repr=False)
    status: GenerationTaskStatus
    progress: int = Field(ge=0, le=100)
    execution_info: dict[str, JsonValue] | None
    result_url: str | None = Field(repr=False)
    result_storage_key: StorageKey | None | Literal[""]
    result_filename: str | None
    result_mime_type: str | None
    result_byte_size: int | None = Field(ge=0)

    @model_validator(mode="after")
    def verify_result(self):
        if bool(self.result_storage_key) != bool(self.result_byte_size):
            raise ValueError("生成测试结果文件记录不完整")
        if self.execution_info is not None:
            TaskExecutionInfo.model_validate(self.execution_info)
        return self


class Reference(HistoryRecord):
    id: Identifier
    task_id: Identifier | None
    role: Literal["reference_image", "reference_audio", "reference_video"] | None
    position: int | None = Field(ge=0)
    original_filename: str
    storage_key: StorageKey
    media_kind: Literal["image", "audio", "video"]
    mime_type: str
    byte_size: int = Field(gt=0)
    legacy_visual_asset_id: Identifier | None
    created_at: datetime

    @model_validator(mode="after")
    def verify_claim(self):
        if (self.task_id is None) != (self.role is None) or (self.task_id is None) != (
            self.position is None
        ):
            raise ValueError("生成测试参考素材认领记录不完整")
        return self


class Transcription(Task):
    source_kind: Literal["upload", "library"]
    source_asset_id: Identifier | None
    input_storage_key: StorageKey
    input_filename: str
    input_mime_type: str
    input_byte_size: int = Field(gt=0)
    language: str
    request_options: dict[str, JsonValue] = Field(repr=False)
    status: TranscriptionTaskStatus
    result_text: str | None = Field(repr=False)
    result_segments: list[dict[str, JsonValue]] = Field(repr=False)
    result_detail: dict[str, JsonValue] = Field(repr=False)
    started_at: datetime | None


class Generations(MigrationBatch[Generation]):
    dataset: Literal["models.test-generations"]


class References(MigrationBatch[Reference]):
    dataset: Literal["models.test-references"]


class Transcriptions(MigrationBatch[Transcription]):
    dataset: Literal["models.test-transcriptions"]


async def validate_reference(session, item):
    if item.task_id:
        task = await session.get(ModelTestGenerationTask, item.task_id)
        if task is None or task.owner_user_id != session.info["owner_user_id"]:
            raise blocked("migration_model_test_reference_task_conflict")


def expected_references(payload):
    expected = {}
    try:
        for field, role, kind in ROLE_FIELDS:
            for identity in IDENTIFIERS.validate_python(reference_ids(payload, field)):
                if identity in expected:
                    raise blocked("migration_model_test_references_invalid")
                expected[identity] = (role, kind)
    except ValidationError:
        raise blocked("migration_model_test_references_invalid") from None
    return expected


async def verify_references(sessions):
    tasks, assets = ModelTestGenerationTask, ModelTestGenerationAsset
    async with sessions(info={"allow_system_reads": True}) as session:
        rows = await session.stream(
            select(
                tasks.id,
                tasks.owner_user_id,
                tasks.request_payload,
                assets.id,
                assets.owner_user_id,
                assets.role,
                assets.media_kind,
            )
            .outerjoin(assets, assets.task_id == tasks.id)
            .order_by(tasks.id, assets.id)
        )
        count, previous, expected = 0, None, {}
        async for identity, owner, payload, asset, asset_owner, role, kind in rows:
            if identity != previous:
                if expected:
                    raise blocked("migration_model_test_references_unresolved")
                count += 1
                previous, expected = identity, expected_references(payload)
            if asset is not None and (
                owner != asset_owner or expected.pop(asset, None) != (role, kind)
            ):
                raise blocked("migration_model_test_reference_task_conflict")
        if expected:
            raise blocked("migration_model_test_references_unresolved")
    return {"record_count": count}


DATASETS = (
    ProjectDataset(
        "models.test-generations",
        ModelTestGenerationTask,
        Generation,
        Generations,
        MigrationPage[Generations],
        validate=partial(validate_model_links, domain="model_test"),
    ),
    ProjectDataset(
        "models.test-references",
        ModelTestGenerationAsset,
        Reference,
        References,
        MigrationPage[References],
        page_size=64,
        validate=validate_reference,
    ),
    ProjectDataset(
        "models.test-transcriptions",
        ModelTestTranscriptionTask,
        Transcription,
        Transcriptions,
        MigrationPage[Transcriptions],
        validate=partial(validate_model_links, domain="model_test"),
    ),
)
