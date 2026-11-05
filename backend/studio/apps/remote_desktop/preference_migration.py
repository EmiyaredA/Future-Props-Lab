"""Preserve the per-account desktop idle setting and its revision."""

from typing import Literal
from uuid import uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from app.console.cloud_control.preference_models import DesktopPreference
from studio.apps.remote_desktop.storage.service_models import DesktopPreferenceImportReceipt
from studio.contracts.management.migration_batches import (
    BatchReceipt,
    MigrationBatch,
    MigrationPage,
)

DATASET = "remote.desktop-preferences"
OWNER_ID = r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"


class PreferenceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    owner_user_id: str = Field(pattern=OWNER_ID)
    idle_minutes: int = Field(strict=True, ge=5, le=120)
    revision: int = Field(strict=True, ge=0)


class PreferenceBatch(MigrationBatch[PreferenceRecord]):
    dataset: Literal["remote.desktop-preferences"]
    records: tuple[PreferenceRecord, ...] = Field(max_length=1)


PreferencePage = MigrationPage[PreferenceBatch]


async def inventory(sessions, plan):
    async with sessions(info={"allow_system_reads": True}) as session:
        owners = set(await session.scalars(select(DesktopPreference.owner_user_id)))
    if owners - {str(owner) for owner in plan.owner_ids}:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": len(owners)}


async def export_page(sessions, plan, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as session:
        row = await session.get(DesktopPreference, str(owner)) if after is None else None
        records = (PreferenceRecord.model_validate(row, from_attributes=True),) if row else ()
    batch = PreferenceBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{after or ''}"),
        records=records,
    )
    return PreferencePage(batch=batch, sha256=batch.digest, next_cursor=None)


async def import_batch(database, batch):
    owner = str(batch.owner_id)
    if batch.records and batch.records[0].owner_user_id != owner:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    key = str(batch.run_id), owner, str(batch.batch_id)
    digest = batch.digest
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        previous = await session.get(DesktopPreferenceImportReceipt, key)
        if previous is not None:
            receipt = BatchReceipt.model_validate(previous.receipt)
            if receipt.sha256 != digest:
                raise HTTPException(409, {"code": "migration_batch_conflict"})
            return receipt
        if await session.get(DesktopPreference, owner) is not None:
            raise HTTPException(409, {"code": "migration_desktop_preference_overlap"})
        if batch.records:
            session.add(DesktopPreference(**batch.records[0].model_dump()))
        receipt = BatchReceipt(
            run_id=batch.run_id,
            owner_id=batch.owner_id,
            batch_id=batch.batch_id,
            dataset=DATASET,
            sha256=digest,
            record_count=len(batch.records),
        )
        session.add(
            DesktopPreferenceImportReceipt(
                run_id=key[0],
                owner_user_id=owner,
                batch_id=key[2],
                receipt=receipt.model_dump(mode="json"),
            )
        )
        await session.commit()
        return receipt
