"""Preserve Thought's external sync history without reviving a legacy grant."""

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator
from sqlalchemy import select

from studio.apps.thought_workshop.external_sync.models import ArticleSyncBinding, ArticleSyncStep
from studio.apps.thought_workshop.storage.models import ThoughtNote
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import blocked


class SyncBinding(HistoryRecord):
    id: Identifier
    note_id: Identifier
    connection_id: Identifier
    document_id: str
    target_key: str
    url: str
    title: str
    revision: int = Field(ge=0)
    last_fingerprint: str
    last_note_revision: int | None
    last_synced_at: datetime | None

    @model_validator(mode="after")
    def verify_target(self):
        if not self.document_id or self.target_key != "feishu:" + self.document_id:
            raise ValueError("外部同步绑定目标不一致")
        return self


class SyncActor(HistoryRecord):
    user_id: Identifier
    auth_kind: Literal["session", "api_key", "management_api_key"]
    api_key_id: Identifier | None = None


class SyncTask(HistoryRecord):
    id: Identifier
    note_id: Identifier
    binding_id: Identifier
    binding_revision: int = Field(ge=0)
    connection_id: Identifier
    connection_revision: int = Field(ge=0)
    target_key: str
    actor: dict
    operation_id: str | None
    note_revision: int = Field(ge=0)
    status: Literal["preview", "succeeded", "conflict", "needs_review", "failed"]
    content: dict
    remote: dict
    checkpoint: dict
    message: str
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def verify_legacy_history(self):
        SyncActor.model_validate(self.actor)
        if {"intent_id", "staging", "payload"} & self.checkpoint.keys():
            raise ValueError("兼容站快照不能提供独立同步执行授权")
        return self


class SyncStep(HistoryRecord):
    id: Identifier
    task_id: Identifier
    kind: str
    status: str
    result: dict
    created_at: datetime


class SyncAsset(HistoryRecord):
    cursor: str
    task_id: Identifier
    asset_id: Identifier


async def legacy_task(db, row):
    record = {field: getattr(row, field) for field in SyncTask.model_fields}
    if row.status in {"queued", "running"}:
        orphan = row.status == "queued" and await db.get(ThoughtNote, row.note_id) is None
        if orphan and (
            row.checkpoint
            or await db.scalar(
                select(ArticleSyncStep.id).where(ArticleSyncStep.task_id == row.id).limit(1)
            )
        ):
            raise blocked("migration_thought_sync_orphan_with_steps")
        record.update(
            status="failed" if orphan else "needs_review",
            checkpoint={
                **row.checkpoint,
                "legacy_cutover_status": row.status,
                "legacy_cutover_message": row.message,
            },
            message=(
                "旧站排队任务的原文档已永久删除"
                if orphan
                else "旧站同步已停止；请核对远端结果后结束任务，再重新预览"
            ),
        )
    return SyncTask.model_validate(record)


async def validate_sync(db, record, owner):
    # Scalar reads of the owner columns distinguish legitimately removed historical
    # resources from another account's rows, which scoped ORM reads would hide.
    note = ThoughtNote.__table__
    binding = ArticleSyncBinding.__table__
    if isinstance(record, SyncBinding):
        actual = await db.scalar(select(note.c.owner_user_id).where(note.c.id == record.note_id))
        if actual != owner:
            raise blocked("migration_thought_sync_note_owner_conflict")
        return
    active = record.status == "needs_review"
    actual = await db.scalar(select(note.c.owner_user_id).where(note.c.id == record.note_id))
    if (actual is not None and actual != owner) or (active and actual is None):
        raise blocked("migration_thought_sync_note_owner_conflict")
    target = (
        await db.execute(
            select(
                binding.c.owner_user_id,
                binding.c.note_id,
                binding.c.connection_id,
                binding.c.target_key,
            ).where(binding.c.id == record.binding_id)
        )
    ).one_or_none()
    if (
        target is not None and (target.owner_user_id, target.note_id) != (owner, record.note_id)
    ) or (active and target is None):
        raise blocked("migration_thought_sync_binding_owner_conflict")
    if active:
        remote = record.checkpoint.get("remote", record.remote)
        document = remote.get("document_id") if isinstance(remote, dict) else None
        if (
            not isinstance(document, str)
            or not document
            or target.connection_id != record.connection_id
            or target.target_key != record.target_key
            or "feishu:" + document != record.target_key
        ):
            raise blocked("migration_thought_sync_target_conflict")
