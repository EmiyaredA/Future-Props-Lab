"""Move Workbench history in parent order and rebuild its account-scoped search index."""

import hashlib
import json
from types import SimpleNamespace
from uuid import uuid5

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError

from app.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchTurn
from app.apps.agent_workbench.execution.transcripts import ACTIVE, end_turn
from app.apps.agent_workbench.models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchEntry,
    WorkbenchOperation,
    WorkbenchSession,
)
from fpl_runtime.migration_receipts import batch_receipt, has_receipt, record_receipt

from .migration_shapes import DATASETS

ACTIVE_OPERATION = {"queued", "running"}


def conflict(code):
    return HTTPException(409, {"code": code})


def joined(dataset, *columns):
    query = select(*columns).select_from(dataset.model)
    if dataset.parent is not None:
        parent, key = dataset.parent
        query = query.outerjoin(parent, parent.id == getattr(dataset.model, key))
    return query


async def inventory(sessions, plan, dataset):
    owner, model = dataset.owner_column, dataset.model
    async with sessions(info={"allow_system_reads": True}) as db:
        if dataset.parent is not None and dataset.owns_record:
            parent, _ = dataset.parent
            invalid = await db.scalar(
                joined(dataset, func.count()).where(
                    or_(parent.owner_user_id.is_(None), parent.owner_user_id != owner)
                )
            )
            if invalid:
                raise conflict("migration_agents_owner_conflict")
        if model is WorkbenchCheckpoint:
            mismatch = await db.scalar(
                joined(dataset, func.count())
                .outerjoin(WorkbenchSession, WorkbenchSession.id == model.session_id)
                .where(
                    model.session_id.is_not(None),
                    or_(
                        WorkbenchSession.owner_user_id.is_(None),
                        WorkbenchSession.owner_user_id != owner,
                    ),
                )
            )
            if mismatch:
                raise conflict("migration_agents_owner_conflict")
        if model is WorkbenchChange:
            mismatch = await db.scalar(
                select(func.count())
                .select_from(model)
                .join(WorkbenchSession, WorkbenchSession.id == model.session_id)
                .where(WorkbenchSession.owner_user_id != owner)
            )
            if mismatch:
                raise conflict("migration_agents_owner_conflict")
        result = await db.execute(joined(dataset, owner, func.count()).group_by(owner))
        counts = dict(result.all())
    if set(counts) - {str(identity) for identity in plan.owner_ids}:
        raise conflict("migration_owner_unassigned")
    return {"record_count": sum(counts.values())}


async def record_values(db, dataset, row):
    fields = {key: getattr(row, key) for key in dataset.record.model_fields}
    if dataset.model is WorkbenchTurn:
        fields["queued_session_id"] = None
        if row.status in ACTIVE:
            copy = SimpleNamespace(**fields)
            end_turn(copy, "interrupted", "切换前的运行已停止，请核对操作结果")
            fields = vars(copy)
    elif dataset.model is WorkbenchChat and not row.queue_paused:
        queued = await db.scalar(
            select(WorkbenchTurn.id)
            .where(
                WorkbenchTurn.chat_id == row.id,
                WorkbenchTurn.owner_user_id == row.owner_user_id,
                WorkbenchTurn.status == "queued",
            )
            .limit(1)
        )
        fields["queue_paused"] = queued is not None
    elif dataset.model is WorkbenchOperation and row.status in ACTIVE_OPERATION:
        fields.update(status="failed", message="切换前的采集任务已停止，请重新发起扫描")
    return dataset.record.model_validate(fields)


async def read_page(sessions, plan, dataset, owner, after):
    model = dataset.model
    query = (
        joined(dataset, model)
        .where(dataset.owner_column == str(owner), model.id > dataset.cursor(after))
        .order_by(model.id)
        .limit(dataset.page_size + 1)
    )
    try:
        async with sessions(info={"owner_user_id": str(owner)}) as db:
            rows = list(await db.scalars(query))
            records = tuple(
                [await record_values(db, dataset, row) for row in rows[: dataset.page_size]]
            )
    except (ValidationError, TypeError, KeyError):
        raise conflict("migration_agents_history_invalid") from None
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
        next_cursor=records[-1].id if len(rows) > dataset.page_size else None,
    )


async def validate_links(db, dataset, record, owner):
    if dataset.parent is not None:
        parent, key = dataset.parent
        linked = await db.get(parent, getattr(record, key))
        if linked is None or linked.owner_user_id != owner:
            raise conflict("migration_agents_owner_conflict")
    if dataset.model is WorkbenchCheckpoint and record.session_id is not None:
        session = await db.get(WorkbenchSession, record.session_id)
        if session is None or session.owner_user_id != owner:
            raise conflict("migration_agents_owner_conflict")
    if dataset.model is WorkbenchTurn and record.status in ACTIVE:
        raise conflict("migration_agents_turn_not_stopped")
    if dataset.model is WorkbenchOperation and record.status in ACTIVE_OPERATION:
        raise conflict("migration_agents_scan_not_stopped")


async def ingest(sessions, dataset, receipt_model, batch):
    owner = str(batch.owner_id)
    ids = [record.id for record in batch.records]
    if batch.dataset != dataset.name or ids != sorted(set(ids)) or len(ids) > dataset.page_size:
        raise HTTPException(422, {"code": "migration_agents_batch_invalid"})
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(db, receipt_model, receipt):
            return receipt
        try:
            for record in batch.records:
                await validate_links(db, dataset, record, owner)
                values = record.model_dump()
                if dataset.owns_record:
                    values["owner_user_id"] = owner
                if dataset.model is WorkbenchChange:
                    values["id"] = int(record.id)
                db.add(dataset.model(**values))
                if dataset.model is WorkbenchEntry and record.text:
                    await db.execute(
                        text(
                            "INSERT INTO agent_workbench_search"
                            "(owner_user_id,session_id,entry_id,text) "
                            "VALUES (:owner,:session,:entry,:text)"
                        ),
                        {
                            "owner": owner,
                            "session": record.session_id,
                            "entry": record.native_id,
                            "text": record.text,
                        },
                    )
            record_receipt(db, receipt_model, receipt)
            await db.commit()
        except IntegrityError:
            raise conflict("migration_agents_history_overlap") from None
    return receipt


async def digest_rows(db, query):
    rows = await db.stream(text(query))
    digest = hashlib.sha256()
    count = 0
    async for row in rows:
        digest.update(json.dumps(tuple(row), ensure_ascii=False, separators=(",", ":")).encode())
        digest.update(b"\n")
        count += 1
    return {"record_count": count, "sha256": digest.hexdigest()}


async def search_inventory(sessions, *, verify_index):
    async with sessions(info={"allow_system_reads": True}) as db:
        expected = await digest_rows(
            db,
            "SELECT s.owner_user_id,e.session_id,e.native_id,e.text "
            "FROM agent_workbench_entries AS e "
            "JOIN agent_workbench_sessions AS s ON s.id=e.session_id "
            "WHERE e.text != '' ORDER BY 1,2,3",
        )
        if verify_index:
            actual = await digest_rows(
                db,
                "SELECT owner_user_id,session_id,entry_id,text "
                "FROM agent_workbench_search ORDER BY 1,2,3",
            )
            if actual != expected:
                raise conflict("migration_agents_search_mismatch")
    return expected


__all__ = ["DATASETS", "ingest", "inventory", "read_page", "search_inventory"]
