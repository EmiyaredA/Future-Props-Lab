"""Preserve replay results from the Presentation partition of legacy edit receipts."""

from datetime import datetime
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.apps.presentation_workshop.models import PresentationProject
from app.runtime.project_operations import ProjectOperationReceipt
from fpl_runtime.migration_batches import MigrationBatch, MigrationPage
from fpl_runtime.migration_receipts import batch_receipt, has_receipt, record_receipt
from fpl_runtime.presentation_migration import ID

from .migration_records import ProjectRecord, page_for
from .models import PresentationMigrationReceipt

KIND = "presentation"
DATASET = "presentation.operation-receipts"
CURSOR = ID[:-1] + r":[0-9A-F]{2,512}$"
CURSOR_COLUMN = (
    ProjectOperationReceipt.resource_id + ":" + func.hex(ProjectOperationReceipt.request_id)
)


class OperationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=CURSOR)
    resource_id: str = Field(pattern=ID)
    request_id: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    result: dict
    created_at: datetime

    @model_validator(mode="after")
    def match_resource(self):
        if (
            self.id != f"{self.resource_id}:{self.request_id.encode().hex().upper()}"
            or ProjectRecord.model_validate(self.result).id != self.resource_id
        ):
            raise ValueError("文稿编辑回执与源项目不一致")
        return self


class OperationBatch(MigrationBatch[OperationRecord]):
    dataset: Literal["presentation.operation-receipts"]
    records: tuple[OperationRecord, ...] = Field(max_length=1)


OperationPage = MigrationPage[OperationBatch]


async def inventory(sessions, plan):
    model = ProjectOperationReceipt
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict(
            (
                await db.execute(
                    select(model.owner_user_id, func.count())
                    .where(model.resource_kind == KIND)
                    .group_by(model.owner_user_id)
                )
            ).all()
        )
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}


async def export_page(sessions, plan, owner, after):
    model = ProjectOperationReceipt
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = (
            (
                await db.execute(
                    select(
                        CURSOR_COLUMN.label("id"),
                        model.resource_id,
                        model.request_id,
                        model.fingerprint,
                        model.result,
                        model.created_at,
                    )
                    .where(
                        model.owner_user_id == str(owner),
                        model.resource_kind == KIND,
                        CURSOR_COLUMN > (after or ""),
                    )
                    .order_by(CURSOR_COLUMN)
                    .limit(2)
                )
            )
            .mappings()
            .all()
        )
    try:
        records = tuple(OperationRecord.model_validate(row) for row in rows[:1])
    except ValidationError:
        raise HTTPException(409, {"code": "migration_presentation_receipt_invalid"}) from None
    return page_for(
        plan,
        owner,
        after,
        dataset=DATASET,
        batch_type=OperationBatch,
        page_type=OperationPage,
        records=records,
        more=len(rows) > 1,
    )


async def ingest(sessions, batch):
    owner = str(batch.owner_id)
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(db, PresentationMigrationReceipt, receipt):
            return receipt
        for record in batch.records:
            project = await db.get(PresentationProject, record.resource_id)
            if project is None or record.result["revision"] > project.revision:
                raise HTTPException(409, {"code": "migration_presentation_receipt_source_missing"})
            db.add(
                ProjectOperationReceipt(
                    owner_user_id=owner, resource_kind=KIND, **record.model_dump(exclude={"id"})
                )
            )
        record_receipt(db, PresentationMigrationReceipt, receipt)
        try:
            await db.commit()
        except IntegrityError:
            raise HTTPException(409, {"code": "migration_presentation_overlap"}) from None
    return receipt
