"""Transfer Interview records and legacy create receipts with original account attribution."""

import hashlib
import json
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator
from sqlalchemy import func, literal, select
from sqlalchemy.orm import DeclarativeBase, aliased

from studio.apps.interview_assistant.files import MAX_FILE_BYTES
from studio.apps.interview_assistant.storage.models import (
    InterviewMaterial,
    InterviewPreparation,
    InterviewRoom,
)
from studio.contracts.interview_assistant.documents import (
    InterviewRoomOut,
    InterviewTaskOut,
    TaskStatus,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier, ProjectRecord
from studio.runtime.database.migration_receipts import ImportReceiptFields
from studio.runtime.database.project_history_migration import CURSOR, ProjectDataset, blocked
from studio.runtime.database.project_operations import ProjectOperationReceipt


class ReceiptBase(DeclarativeBase):
    pass


class InterviewImportReceipt(ImportReceiptFields, ReceiptBase):
    __tablename__ = "interview_import_receipts"


class Room(ProjectRecord):
    user_id: Identifier
    input_version: int = Field(ge=0)
    active_task_id: Identifier | None
    active_bundle_id: Identifier | None


class Material(HistoryRecord):
    id: Identifier
    room_id: Identifier
    filename: str = Field(min_length=1, max_length=255)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size: int = Field(gt=0, le=MAX_FILE_BYTES)
    created_at: datetime

    @model_validator(mode="after")
    def check_filename(self):
        if any(char in self.filename for char in ("/", "\\", "\x00")):
            raise ValueError("面试材料文件名无效")
        return self


class Preparation(HistoryRecord):
    id: Identifier
    room_id: Identifier
    user_id: Identifier
    request_id: str = Field(min_length=1, max_length=100)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    input_version: int = Field(ge=0)
    snapshot: dict
    status: TaskStatus
    revision: int = Field(ge=0)
    events: list[dict]
    result: dict | None
    message: str
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def check_history(self):
        task = InterviewTaskOut.model_validate(
            self.model_dump(exclude={"request_id", "fingerprint", "user_id"})
        )
        if task.result is not None and (task.result.task_id, task.result.input_hash) != (
            self.id,
            self.input_hash,
        ):
            raise ValueError("面试资料交付与准备任务不一致")
        canonical = json.dumps(self.snapshot, sort_keys=True, ensure_ascii=False).encode()
        if hashlib.sha256(canonical).hexdigest() != self.input_hash:
            raise ValueError("面试准备输入摘要不一致")
        return self


class CreateReceipt(HistoryRecord):
    resource_kind: Literal["interview-create"]
    resource_id: Identifier
    request_id: str = Field(min_length=1, max_length=100)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    result: dict
    created_at: datetime

    @property
    def id(self):
        return f"{self.resource_id}:{self.request_id.encode().hex().upper()}"

    @model_validator(mode="after")
    def check_history(self):
        InterviewRoomOut.model_validate(self.result)
        return self


class RoomBatch(MigrationBatch[Room]):
    dataset: Literal["interview.rooms"]


class MaterialBatch(MigrationBatch[Material]):
    dataset: Literal["interview.materials"]


class PreparationBatch(MigrationBatch[Preparation]):
    dataset: Literal["interview.preparations"]


class CreateBatch(MigrationBatch[CreateReceipt]):
    dataset: Literal["interview.create-receipts"]


class CreateDataset(ProjectDataset):
    def select(self, *columns):
        return super().select(*columns).where(self.model.resource_kind == "interview-create")

    def key_for(self, row):
        if row is self.model:
            return self.model.resource_id + literal(":") + func.hex(self.model.request_id)
        return row.id


async def verify_preparation(session, record):
    room = await session.get(InterviewRoom, record.room_id)
    if room is None or room.user_id != record.user_id or record.input_version > room.input_version:
        raise blocked("migration_interview_task_room_conflict")
    material = record.snapshot.get("material")
    if material is not None:
        attached = await session.get(InterviewMaterial, material["id"])
        if (
            attached is None
            or attached.room_id != room.id
            or attached.filename != material["filename"]
            or attached.sha256 != material["sha256"]
        ):
            raise blocked("migration_interview_task_material_conflict")


async def verify_create_receipt(session, record):
    # A deleted room can still have a create receipt. Retain the old result and
    # distinguish a truly absent room from one belonging to a different account.
    room = InterviewRoom.__table__
    target = (
        await session.execute(
            select(room.c.owner_user_id, room.c.user_id, room.c.revision).where(
                room.c.id == record.result["id"]
            )
        )
    ).one_or_none()
    if target is not None and (
        target.owner_user_id != session.info["owner_user_id"]
        or target.user_id != record.resource_id
        or target.revision < record.result["revision"]
    ):
        raise blocked("migration_interview_create_receipt_conflict")


async def verify_room_links(sessions):
    active = aliased(InterviewPreparation)
    bundle = aliased(InterviewPreparation)
    async with sessions(info={"allow_system_reads": True}) as session:
        rows = await session.stream(
            select(InterviewRoom, active, bundle)
            .outerjoin(active, active.id == InterviewRoom.active_task_id)
            .outerjoin(bundle, bundle.id == InterviewRoom.active_bundle_id)
        )
        count = 0
        async for room, task, delivered in rows:
            for identifier, linked in (
                (room.active_task_id, task),
                (room.active_bundle_id, delivered),
            ):
                if identifier is not None and (
                    linked is None
                    or (linked.room_id, linked.owner_user_id, linked.user_id)
                    != (room.id, room.owner_user_id, room.user_id)
                ):
                    raise blocked("migration_interview_room_links_invalid")
            if delivered is not None and (
                delivered.status != "succeeded" or delivered.result is None
            ):
                raise blocked("migration_interview_room_bundle_invalid")
            count += 1
    return {"record_count": count}


CREATES = CreateDataset(
    "interview.create-receipts",
    ProjectOperationReceipt,
    CreateReceipt,
    CreateBatch,
    MigrationPage[CreateBatch],
    cursor_pattern=CURSOR[:-1] + r":[0-9A-F]{2,800}$",
    validate=verify_create_receipt,
)
DATASETS = (
    ProjectDataset(
        "interview.rooms", InterviewRoom, Room, RoomBatch, MigrationPage[RoomBatch], page_size=16
    ),
    ProjectDataset(
        "interview.materials",
        InterviewMaterial,
        Material,
        MaterialBatch,
        MigrationPage[MaterialBatch],
        project=InterviewRoom,
        parent_key="room_id",
        owns_record=False,
        page_size=32,
    ),
    ProjectDataset(
        "interview.preparations",
        InterviewPreparation,
        Preparation,
        PreparationBatch,
        MigrationPage[PreparationBatch],
        project=InterviewRoom,
        parent_key="room_id",
        validate=verify_preparation,
    ),
    CREATES,
)
