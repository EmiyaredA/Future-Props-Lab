"""Preserve exact edit replay results after each owning document is imported."""

from datetime import datetime
from functools import partial
from uuid import uuid5

from fastapi import HTTPException
from pydantic import Field, ValidationError, model_validator
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError

from app.runtime.project_operations import ProjectOperationReceipt

from .library_assets import ID
from .migration_apps import mount_dataset
from .migration_batches import MigrationBatch, MigrationPage
from .migration_receipts import batch_receipt, has_receipt, record_receipt
from .project_history_records import HistoryRecord, Identifier

CURSOR = rf"^{ID}:[0-9A-F]{{2,512}}$"
SUFFIX = "operation-receipts"
RECEIPT = ProjectOperationReceipt
CURSOR_COLUMN = RECEIPT.resource_id + ":" + func.hex(RECEIPT.request_id)


class EditReceipt(HistoryRecord):
    id: str = Field(pattern=CURSOR)
    resource_id: Identifier
    request_id: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    result: dict
    created_at: datetime

    @model_validator(mode="after")
    def check_result_identity(self):
        if (
            self.id != f"{self.resource_id}:{self.request_id.encode().hex().upper()}"
            or self.result.get("project_id") != self.resource_id
            or type(self.result.get("revision")) is not int
            or self.result["revision"] < 1
        ):
            raise ValueError("编辑回执的项目或版本无效")
        return self


class EditReceiptBatch(MigrationBatch[EditReceipt]):
    records: tuple[EditReceipt, ...] = Field(max_length=1)


class EditReceiptTransfer:
    def __init__(self, kind, project, document, response, batch, receipt):
        self.kind, self.project, self.document, self.response = kind, project, document, response
        self.batch, self.page, self.receipt = batch, MigrationPage[batch], receipt
        self.name = f"{kind}.{SUFFIX}"

    def _source(self, *columns):
        return (
            select(*columns)
            .select_from(RECEIPT)
            .outerjoin(
                self.project,
                and_(
                    self.project.id == RECEIPT.resource_id,
                    self.project.owner_user_id == RECEIPT.owner_user_id,
                ),
            )
            .outerjoin(self.document, self.document.project_id == self.project.id)
            .where(RECEIPT.resource_kind == self.kind)
        )

    async def inventory(self, sessions, plan):
        async with sessions(info={"allow_system_reads": True}) as session:
            missing = await session.scalar(
                self._source(func.count()).where(
                    or_(self.project.id.is_(None), self.document.project_id.is_(None))
                )
            )
            if missing:
                raise HTTPException(409, {"code": "migration_edit_receipt_source_missing"})
            counts = dict(
                (
                    await session.execute(
                        self._source(RECEIPT.owner_user_id, func.count()).group_by(
                            RECEIPT.owner_user_id
                        )
                    )
                ).all()
            )
        if set(counts) - {str(owner) for owner in plan.owner_ids}:
            raise HTTPException(409, {"code": "migration_owner_unassigned"})
        return {"record_count": sum(counts.values())}

    def _check_response(self, record, current_revision):
        try:
            self.response.model_validate(record.result)
            if current_revision is None or record.result["revision"] > current_revision:
                raise ValueError("编辑回执超出已保存版本")
        except ValueError:
            raise HTTPException(409, {"code": "migration_edit_receipt_invalid"}) from None

    async def export(self, sessions, plan, owner, after):
        async with sessions(info={"owner_user_id": str(owner)}) as session:
            rows = (
                (
                    await session.execute(
                        self._source(
                            CURSOR_COLUMN.label("id"),
                            RECEIPT.resource_id,
                            RECEIPT.request_id,
                            RECEIPT.fingerprint,
                            RECEIPT.result,
                            RECEIPT.created_at,
                            self.document.revision.label("current_revision"),
                        )
                        .where(RECEIPT.owner_user_id == str(owner), CURSOR_COLUMN > (after or ""))
                        .order_by(CURSOR_COLUMN)
                        .limit(2)
                    )
                )
                .mappings()
                .all()
            )
        records = []
        try:
            for row in rows[:1]:
                values = dict(row)
                revision = values.pop("current_revision")
                record = EditReceipt.model_validate(values)
                self._check_response(record, revision)
                records.append(record)
        except ValidationError:
            raise HTTPException(409, {"code": "migration_edit_receipt_invalid"}) from None
        batch = self.batch(
            run_id=plan.run_id,
            source_revision=plan.source_revision,
            source_database_sha256=plan.source_database_sha256,
            dataset=self.name,
            owner_id=owner,
            batch_id=uuid5(plan.run_id, f"{self.name}/{owner}/{after or ''}"),
            records=tuple(records),
        )
        return self.page(
            batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(rows) > 1 else None
        )

    async def ingest(self, sessions, batch):
        owner = str(batch.owner_id)
        receipt = batch_receipt(batch)
        async with sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            if await has_receipt(session, self.receipt, receipt):
                return receipt
            for record in batch.records:
                project = await session.get(self.project, record.resource_id)
                if project is None or project.owner_user_id != owner:
                    raise HTTPException(409, {"code": "migration_edit_receipt_source_missing"})
                document = await session.get(self.document, record.resource_id)
                if document is None:
                    raise HTTPException(409, {"code": "migration_edit_receipt_source_missing"})
                self._check_response(record, document.revision)
                session.add(
                    RECEIPT(
                        owner_user_id=owner,
                        resource_kind=self.kind,
                        **record.model_dump(exclude={"id"}),
                    )
                )
            record_receipt(session, self.receipt, receipt)
            try:
                await session.commit()
            except IntegrityError:
                raise HTTPException(409, {"code": "migration_edit_receipt_overlap"}) from None
        return receipt

    def mount(self, app, plan, sessions, prefix, *, source):
        mount_dataset(
            app,
            prefix=f"{prefix}/{SUFFIX}",
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=self.batch,
            page_model=self.page,
            inventory=partial(self.inventory, sessions, plan),
            page=partial(self.export, sessions, plan),
            ingest=partial(self.ingest, sessions) if source is None else None,
            source=source,
        )
