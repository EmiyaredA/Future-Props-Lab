"""Export and import the Tools navigation business dataset, one account per batch."""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text

from app.tool_navigation.models import ToolNavigationItem
from fpl_runtime.migration_batches import MAX_RECORDS, BatchReceipt, MigrationBatch, MigrationPage

from .models import ToolsNavigationImportReceipt

DATASET = "tools.navigation"
TOOL_ID = r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"


class NavigationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    tool_id: str = Field(pattern=TOOL_ID)
    is_favorite: bool = Field(strict=True)
    favorite_updated_at: datetime | None
    last_used_at: datetime | None
    use_count: int = Field(ge=0, strict=True)
    updated_at: datetime


class NavigationBatch(MigrationBatch[NavigationRecord]):
    dataset: Literal["tools.navigation"]


NavigationPage = MigrationPage[NavigationBatch]


async def export_page(sessions, plan, owner: UUID, after: str | None):
    async with sessions(info={"owner_user_id": str(owner)}) as session:
        rows = await session.scalars(
            select(ToolNavigationItem)
            .where(
                ToolNavigationItem.owner_user_id == str(owner),
                ToolNavigationItem.tool_id > (after or ""),
            )
            .order_by(ToolNavigationItem.tool_id)
            .limit(MAX_RECORDS + 1)
        )
        values = list(rows)
        records = tuple(
            NavigationRecord.model_validate(row, from_attributes=True)
            for row in values[:MAX_RECORDS]
        )
    batch = NavigationBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{after or ''}"),
        records=records,
    )
    return NavigationPage(
        batch=batch,
        sha256=batch.digest,
        next_cursor=records[-1].tool_id if len(values) > MAX_RECORDS else None,
    )


async def import_batch(database, batch):
    ids = [record.tool_id for record in batch.records]
    if ids != sorted(set(ids)):
        raise HTTPException(422, {"code": "migration_record_order_invalid"})
    owner = str(batch.owner_id)
    key = str(batch.run_id), owner, str(batch.batch_id)
    digest = batch.digest
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        previous = await session.get(ToolsNavigationImportReceipt, key)
        if previous is not None:
            receipt = BatchReceipt.model_validate(previous.receipt)
            if receipt.sha256 != digest:
                raise HTTPException(409, {"code": "migration_batch_conflict"})
            return receipt
        if ids and await session.scalar(
            select(ToolNavigationItem.tool_id)
            .where(ToolNavigationItem.owner_user_id == owner, ToolNavigationItem.tool_id.in_(ids))
            .limit(1)
        ):
            raise HTTPException(409, {"code": "migration_navigation_overlap"})
        session.add_all(
            [
                ToolNavigationItem(owner_user_id=owner, **record.model_dump())
                for record in batch.records
            ]
        )
        receipt = BatchReceipt(
            run_id=batch.run_id,
            owner_id=batch.owner_id,
            batch_id=batch.batch_id,
            sha256=digest,
            record_count=len(ids),
            dataset=DATASET,
        )
        session.add(
            ToolsNavigationImportReceipt(
                run_id=key[0],
                owner_user_id=owner,
                batch_id=key[2],
                receipt=receipt.model_dump(mode="json"),
            )
        )
        await session.commit()
        return receipt


async def navigation_inventory(sessions, owners, *, system=False):
    info = {"allow_system_reads": True} if system else {}
    async with sessions(info=info) as session:
        rows = await session.execute(
            select(ToolNavigationItem.owner_user_id, func.count()).group_by(
                ToolNavigationItem.owner_user_id
            )
        )
        counts = dict(rows.all())
    allowed = {str(owner) for owner in owners}
    if set(counts) - allowed:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}
