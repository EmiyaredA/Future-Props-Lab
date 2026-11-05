"""Preserve template synchronization history and the Models capacity ledger."""

from dataclasses import replace
from datetime import datetime
from functools import partial
from typing import Literal

from cryptography.fernet import InvalidToken
from pydantic import Field, JsonValue, ValidationError, model_validator
from sqlalchemy import column, select, table

from studio.apps.model_service.settings_migration import verify_role_template
from studio.apps.model_service.storage.models.model_templates import (
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
)
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.model_service.storage.task_records import TASK_MODELS
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

EXTERNAL_TASKS = {
    kind: table(name, column("id"), column("owner_user_id"))
    for kind, name in {
        "visual": "visual_generation_tasks",
        "visual_acceptance": "visual_acceptance_runs",
        "galgame_asr": "galgame_asset_transcription_tasks",
    }.items()
}


class SyncJob(HistoryRecord):
    id: Identifier
    role: Literal["admin", "user"]
    template_revision: int = Field(ge=0)
    template_snapshot: dict[str, JsonValue] = Field(repr=False)
    status: Literal["preview", "pending", "running", "completed"]
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class SyncItem(HistoryRecord):
    id: Identifier
    job_id: Identifier
    owner_user_id: Identifier
    account_name: str
    catalog_revision: int = Field(ge=0)
    status: Literal["pending", "skipped", "succeeded", "failed"]
    summary: dict[str, JsonValue] = Field(repr=False)
    error_message: str = Field(repr=False)
    created_at: datetime
    updated_at: datetime


class Admission(HistoryRecord):
    id: Identifier
    user_id: Identifier | None
    platform_role: Literal["admin", "user"]
    realtime_voice: bool
    weight: int = Field(ge=1)
    task_kind: (
        Literal["inference", "model", "transcription", "visual", "visual_acceptance", "galgame_asr"]
        | None
    )
    task_ids: list[Identifier]
    waiting: bool
    queue_task_id: Identifier | None
    released_at: datetime | None
    created_at: datetime

    @model_validator(mode="after")
    def check_task_shape(self):
        if (
            (self.task_kind is None and self.task_ids)
            or len(set(self.task_ids)) != len(self.task_ids)
            or (self.waiting and self.queue_task_id is None)
            or (
                self.queue_task_id is not None
                and (self.task_kind != "visual" or self.task_ids != [self.queue_task_id])
            )
            or (self.released_at is None and self.task_kind is not None and not self.task_ids)
        ):
            raise ValueError("模型额度任务关联无效")
        return self


class SyncJobs(MigrationBatch[SyncJob]):
    dataset: Literal["models.template-sync-jobs"]


class SyncItems(MigrationBatch[SyncItem]):
    dataset: Literal["models.template-sync-items"]


class Admissions(MigrationBatch[Admission]):
    dataset: Literal["models.runtime-admissions"]


async def verify_job(_session, item, *, cipher):
    try:
        verify_role_template(cipher, item.template_snapshot)
    except ValidationError:
        raise blocked("migration_model_sync_snapshot_invalid") from None
    except (InvalidToken, UnicodeError, ValueError):
        raise blocked("migration_model_credential_unreadable") from None


async def verify_sync_item(session, item, *, owners):
    job = await session.get(ModelTemplateSyncJob, item.job_id)
    if (
        job is None
        or job.actor_user_id != session.info["owner_user_id"]
        or item.owner_user_id not in owners
    ):
        raise blocked("migration_model_sync_account_conflict")


async def verify_admission(session, item, *, owners, legacy):
    owner = session.info["owner_user_id"]
    active = item.released_at is None
    if item.user_id is not None and (
        item.user_id not in owners or (active and item.user_id != owner)
    ):
        raise blocked("migration_model_admission_account_conflict")
    if item.task_kind in EXTERNAL_TASKS:
        if active:
            raise blocked("migration_model_external_admission_active")
        if not legacy:
            # Retain the historical link without opening a peer service database.
            return
        model = EXTERNAL_TASKS[item.task_kind]
    elif item.task_kind is not None:
        model = TASK_MODELS[item.task_kind].__table__
    else:
        return
    rows = dict(
        (
            await session.execute(
                select(model.c.id, model.c.owner_user_id).where(model.c.id.in_(item.task_ids))
            )
        ).all()
    )
    if any(candidate != owner for candidate in rows.values()) or (
        active and len(rows) != len(item.task_ids)
    ):
        raise blocked("migration_model_admission_task_conflict")


DATASETS = (
    ProjectDataset(
        "models.template-sync-jobs",
        ModelTemplateSyncJob,
        SyncJob,
        SyncJobs,
        MigrationPage[SyncJobs],
        owner_key="actor_user_id",
    ),
    ProjectDataset(
        "models.template-sync-items",
        ModelTemplateSyncItem,
        SyncItem,
        SyncItems,
        MigrationPage[SyncItems],
        project=ModelTemplateSyncJob,
        owner_key="actor_user_id",
        parent_key="job_id",
        owns_record=False,
        page_size=32,
    ),
    ProjectDataset(
        "models.runtime-admissions",
        RuntimeAdmission,
        Admission,
        Admissions,
        MigrationPage[Admissions],
        page_size=32,
    ),
)


def bind_governance(plan, *, legacy, cipher):
    owners = frozenset(map(str, plan.owner_ids))
    validators = (
        partial(verify_job, cipher=cipher),
        partial(verify_sync_item, owners=owners),
        partial(verify_admission, owners=owners, legacy=legacy),
    )
    return tuple(
        replace(dataset, validate=validate)
        for dataset, validate in zip(DATASETS, validators, strict=True)
    )
