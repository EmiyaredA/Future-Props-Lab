"""Recover owned Video render removal and ordered historical segment downloads."""

import asyncio
from hashlib import sha256
from typing import Literal
from uuid import UUID, uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import JSON, column, func, or_, select, table, text
from sqlalchemy.exc import IntegrityError

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.scope import is_library_asset
from studio.apps.asset_library.storage.service_models import VideoFileWriteReceipt
from studio.apps.asset_library.video.video_files import record as file_record
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import Identifier
from studio.contracts.video_editor.video_segments import PublishedSegment, segment_receipt_id
from studio.runtime.database.migration_apps import mount_dataset
from studio.runtime.database.migration_receipts import batch_receipt, has_receipt, record_receipt
from studio.runtime.database.project_history_migration import CURSOR
from studio.runtime.files.signed_payloads import ModelOutputDescription

from .migration_blobs import AssetBlobs
from .migration_models import AssetImportReceipt, AssetVideoOutputHistory

DATASET = "assets.video-output-receipts"
PREFIX = "/v1/migration/assets/video-output-receipts"
TASKS = table(
    "video_editor_tasks",
    column("id"),
    column("owner_user_id"),
    column("project_id"),
    column("kind"),
    column("status"),
    column("output_asset_id"),
    column("result_detail", JSON),
)
PROJECTS = table("video_editor_projects", column("id"), column("owner_user_id"))


class LegacyOutputFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: Identifier
    size: int = Field(gt=0, strict=True)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class LegacyOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: Identifier
    project_id: Identifier
    kind: Literal["render", "segment_export"]
    library: bool
    files: tuple[LegacyOutputFile, ...] = Field(min_length=1, max_length=100)

    @field_validator("id")
    @classmethod
    def check_task_id(cls, value):
        if str(UUID(value)) != value:
            raise ValueError("历史剪辑任务标识无效")
        return value

    @model_validator(mode="after")
    def check_results(self):
        if len({item.id for item in self.files}) != len(self.files) or (
            self.kind == "render" and (self.library or len(self.files) != 1)
        ):
            raise ValueError("历史剪辑输出范围冲突")
        return self


class LegacyOutputBatch(MigrationBatch[LegacyOutput]):
    dataset: Literal["assets.video-output-receipts"]


LegacyOutputPage = MigrationPage[LegacyOutputBatch]


def conflict(code="migration_video_output_conflict"):
    return HTTPException(409, {"code": code})


def finished():
    return (
        TASKS.c.status == "completed",
        or_(
            (TASKS.c.kind == "render") & TASKS.c.output_asset_id.is_not(None),
            TASKS.c.kind == "segment_export",
        ),
    )


def outputs_for(task):
    if task.kind == "render":
        return [task.output_asset_id], False
    detail = task.result_detail
    segments = detail.get("segments")
    library = detail.get("importRequested")
    if (
        not isinstance(segments, list)
        or not segments
        or type(library) is not bool
        or any(item.get("status") != "completed" for item in segments)
    ):
        raise ValueError("历史分段结果缺失")
    return [item["assetId"] for item in segments], library


class OutputHistory:
    def __init__(self, sessions, plan, root, *, legacy):
        self.sessions, self.plan, self.legacy = sessions, plan, legacy
        self.blobs = AssetBlobs(root, sessions)

    async def inventory(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            if self.legacy:
                invalid = await db.scalar(
                    select(func.count())
                    .select_from(TASKS.outerjoin(PROJECTS, PROJECTS.c.id == TASKS.c.project_id))
                    .where(
                        *finished(),
                        or_(
                            PROJECTS.c.id.is_(None),
                            PROJECTS.c.owner_user_id != TASKS.c.owner_user_id,
                        ),
                    )
                )
                if invalid:
                    raise conflict("migration_video_output_owner_conflict")
                owner = TASKS.c.owner_user_id
                query = select(owner, func.count()).where(*finished()).group_by(owner)
            else:
                owner = AssetVideoOutputHistory.owner_user_id
                query = select(owner, func.count()).group_by(owner)
            counts = dict((await db.execute(query)).all())
        if set(counts) - {str(owner) for owner in self.plan.owner_ids}:
            raise conflict("migration_owner_unassigned")
        return {"record_count": sum(counts.values())}

    async def selected_files(self, db, owner, project, library, ids):
        items = list(
            await db.scalars(
                select(VisualAsset).where(
                    VisualAsset.owner_user_id == owner, VisualAsset.id.in_(ids)
                )
            )
        )
        by_id = {row.id: row for row in items}
        if len(ids) != len(by_id) or any(
            not (is_library_asset(row) if library else row.video_editor_project_id == project)
            or row.media_kind != "video"
            for row in items
        ):
            raise conflict("migration_video_output_owner_conflict")
        return [by_id[identity] for identity in ids]

    async def measure(self, rows):
        files = []
        for row in rows:
            try:
                original, _path = await asyncio.to_thread(self.blobs.measure, row)
            except (OSError, ValueError):
                raise conflict("migration_video_output_file_conflict") from None
            files.append(LegacyOutputFile(id=row.id, size=original.size, sha256=original.sha256))
        return tuple(files)

    async def page(self, owner_id, after):
        owner = str(owner_id)
        records = ()
        async with self.sessions(info={"owner_user_id": owner}) as db:
            if self.legacy:
                rows = (
                    await db.execute(
                        select(TASKS)
                        .where(
                            *finished(), TASKS.c.owner_user_id == owner, TASKS.c.id > (after or "")
                        )
                        .order_by(TASKS.c.id)
                        .limit(2)
                    )
                ).all()
                if rows:
                    task = rows[0]
                    try:
                        ids, library = outputs_for(task)
                        assets = await self.selected_files(db, owner, task.project_id, library, ids)
                        records = (
                            LegacyOutput(
                                id=task.id,
                                project_id=task.project_id,
                                kind=task.kind,
                                library=library,
                                files=await self.measure(assets),
                            ),
                        )
                    except (ValueError, KeyError, TypeError, AttributeError):
                        raise conflict() from None
            else:
                rows = list(
                    await db.scalars(
                        select(AssetVideoOutputHistory)
                        .where(AssetVideoOutputHistory.id > (after or ""))
                        .order_by(AssetVideoOutputHistory.id)
                        .limit(2)
                    )
                )
                if rows:
                    record = LegacyOutput.model_validate(rows[0].record)
                    expected = await self.rebuild_receipt(db, owner, record)
                    current = await db.get(VideoFileWriteReceipt, (owner, expected.request_id))
                    if current is None or (
                        current.project_id,
                        current.fingerprint,
                        current.result,
                    ) != (expected.project_id, expected.fingerprint, expected.result):
                        raise conflict()
                    records = (record,)
        batch = LegacyOutputBatch(
            run_id=self.plan.run_id,
            source_revision=self.plan.source_revision,
            source_database_sha256=self.plan.source_database_sha256,
            dataset=DATASET,
            owner_id=owner_id,
            batch_id=uuid5(self.plan.run_id, f"{DATASET}/{owner}/{after or ''}"),
            records=records,
        )
        return LegacyOutputPage(
            batch=batch,
            sha256=batch.digest,
            next_cursor=str(records[0].id) if len(rows) > 1 else None,
        )

    async def rebuild_receipt(self, db, owner, record):
        rows = await self.selected_files(
            db, owner, record.project_id, record.library, [file.id for file in record.files]
        )
        if await self.measure(rows) != record.files:
            raise conflict("migration_video_output_file_conflict")
        if record.kind == "render":
            row, file = rows[0], record.files[0]
            descriptor = ModelOutputDescription(
                row.original_filename, row.mime_type, file.size, file.sha256
            )
            identity, fingerprint = UUID(record.id).hex, descriptor.fingerprint
            result = [file_record(record.project_id, row)]
        else:
            identity = segment_receipt_id(str(record.id))
            fingerprint = sha256(record.model_dump_json().encode()).hexdigest()
            result = [
                PublishedSegment(
                    asset=file_record(record.project_id, row),
                    sha256=file.sha256,
                    library=record.library,
                ).model_dump(mode="json")
                for row, file in zip(rows, record.files, strict=True)
            ]
        return VideoFileWriteReceipt(
            owner_user_id=owner,
            request_id=identity,
            project_id=record.project_id,
            fingerprint=fingerprint,
            result=result,
        )

    async def ingest(self, batch):
        if len(batch.records) > 1:
            raise HTTPException(422, {"code": "migration_record_order_invalid"})
        owner, receipt = str(batch.owner_id), batch_receipt(batch)
        async with self.sessions(info={"owner_user_id": owner}) as db:
            projections = [
                await self.rebuild_receipt(db, owner, record) for record in batch.records
            ]
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if await has_receipt(db, AssetImportReceipt, receipt):
                return receipt
            for record, projection in zip(batch.records, projections, strict=True):
                db.add(projection)
                db.add(
                    AssetVideoOutputHistory(
                        owner_user_id=owner,
                        id=str(record.id),
                        record=record.model_dump(mode="json"),
                    )
                )
            record_receipt(db, AssetImportReceipt, receipt)
            try:
                await db.commit()
            except IntegrityError:
                raise conflict("migration_video_output_overlap") from None
        return receipt


def mount_video_outputs(app, plan, sessions, root, *, source=None):
    handler = OutputHistory(sessions, plan, root, legacy=source is not None)
    mount_dataset(
        app,
        prefix=PREFIX,
        plan=plan,
        cursor_pattern=CURSOR,
        batch_model=LegacyOutputBatch,
        page_model=LegacyOutputPage,
        inventory=handler.inventory,
        page=handler.page,
        ingest=handler.ingest if source is None else None,
        source=source,
    )
