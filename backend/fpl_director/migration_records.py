"""Validate and move Director projects and user motions under their original owners."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.apps.director_desk.models import DirectorDeskProject, DirectorDeskUserMotion
from app.apps.director_desk.motions import MOTION_KEY, file_keys
from app.apps.director_desk.schemas import DirectorDocument, DirectorMotionWrite
from fpl_runtime.migration_batches import BatchReceipt, MigrationBatch, MigrationPage

from .migration_receipts import has_receipt, record_receipt

ID = r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$"
PAGE_SIZE = 1


class DirectorRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=ID)
    created_at: datetime
    updated_at: datetime


class ProjectRecord(DirectorRecord):
    title: str = Field(min_length=1, max_length=120)
    document: dict
    revision: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_project(self):
        if DirectorDocument.model_validate(self.document).name != self.title:
            raise ValueError("导演台标题与文档名称不一致")
        return self


class MotionRecord(DirectorRecord, DirectorMotionWrite):
    motion_key: str = Field(max_length=200, pattern=MOTION_KEY.pattern)
    name: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_motion(self):
        name = self.motion.get("name")
        if not isinstance(name, str) or name.strip() != self.name or not file_keys(self.resource):
            raise ValueError("导演台动作资源不完整")
        return self


class Projects(MigrationBatch[ProjectRecord]):
    dataset: Literal["director.projects"]
    records: tuple[ProjectRecord, ...] = Field(max_length=PAGE_SIZE)


class Motions(MigrationBatch[MotionRecord]):
    dataset: Literal["director.motions"]
    records: tuple[MotionRecord, ...] = Field(max_length=PAGE_SIZE)


@dataclass(frozen=True)
class Dataset:
    name: str
    model: type
    record: type[DirectorRecord]
    batch: type[MigrationBatch]
    page: type[MigrationPage]


DATASETS = (
    Dataset(
        "director.projects", DirectorDeskProject, ProjectRecord, Projects, MigrationPage[Projects]
    ),
    Dataset(
        "director.motions", DirectorDeskUserMotion, MotionRecord, Motions, MigrationPage[Motions]
    ),
)


async def inventory(sessions, plan, dataset):
    model = dataset.model
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict(
            (
                await db.execute(
                    select(model.owner_user_id, func.count()).group_by(model.owner_user_id)
                )
            ).all()
        )
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}


async def export_page(sessions, plan, dataset, owner, after):
    model = dataset.model
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = list(
            await db.scalars(
                select(model)
                .where(model.owner_user_id == str(owner), model.id > (after or ""))
                .order_by(model.id)
                .limit(PAGE_SIZE + 1)
            )
        )
    try:
        records = tuple(
            dataset.record.model_validate(row, from_attributes=True) for row in rows[:PAGE_SIZE]
        )
    except ValidationError:
        raise HTTPException(409, {"code": "migration_director_record_invalid"}) from None
    batch = dataset.batch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset.name,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset.name}/{owner}/{after or ''}"),
        records=records,
    )
    return dataset.page(
        batch=batch,
        sha256=batch.digest,
        next_cursor=records[-1].id if len(rows) > PAGE_SIZE else None,
    )


async def import_batch(sessions, dataset, batch):
    owner = str(batch.owner_id)
    receipt = BatchReceipt(
        run_id=batch.run_id,
        owner_id=batch.owner_id,
        batch_id=batch.batch_id,
        dataset=dataset.name,
        sha256=batch.digest,
        record_count=len(batch.records),
    )
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if not await has_receipt(db, receipt):
            db.add_all(
                [
                    dataset.model(owner_user_id=owner, **record.model_dump())
                    for record in batch.records
                ]
            )
            record_receipt(db, receipt)
            try:
                await db.commit()
            except IntegrityError:
                raise HTTPException(409, {"code": "migration_director_record_overlap"}) from None
    return receipt
