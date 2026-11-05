"""Move project and child records through the owner's typed maintenance transport."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from uuid import uuid5

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError

from .library_assets import ID
from .migration_apps import mount_dataset
from .migration_receipts import batch_receipt, has_receipt, record_receipt

CURSOR = f"^{ID}$"


@dataclass(frozen=True)
class ProjectDataset:
    name: str
    model: type
    record: type
    batch: type
    page: type
    key: str = "id"
    project: type | None = None
    owns_record: bool = True
    page_size: int = 1
    cursor_pattern: str = CURSOR
    projection: Callable | None = None
    validate: Callable | None = None

    @property
    def suffix(self):
        return self.name.split(".", 1)[1]

    @property
    def owner_column(self):
        model = self.project if self.project is not None else self.model
        return model.owner_user_id

    def select(self, *columns):
        query = select(*columns).select_from(self.model)
        if self.project is not None:
            query = query.join(self.project, self.project.id == self.model.project_id, isouter=True)
        return query

    def key_for(self, value):
        return getattr(value, self.key)


def blocked(code):
    return HTTPException(409, {"code": code})


async def inventory(sessions, plan, dataset):
    owner = dataset.owner_column
    async with sessions(info={"allow_system_reads": True}) as session:
        if dataset.project is not None and dataset.owns_record:
            invalid = await session.scalar(
                dataset.select(func.count()).where(
                    or_(
                        owner.is_(None),
                        dataset.model.owner_user_id.is_(None),
                        dataset.model.owner_user_id != owner,
                    )
                )
            )
            if invalid:
                raise blocked("migration_project_owner_conflict")
        counts = dict(
            (await session.execute(dataset.select(owner, func.count()).group_by(owner))).all()
        )
    if set(counts) - {str(owner_id) for owner_id in plan.owner_ids}:
        raise blocked("migration_owner_unassigned")
    return {"record_count": sum(counts.values())}


async def read_page(sessions, plan, dataset, owner, after):
    key = dataset.key_for(dataset.model)
    query = (
        dataset.select(dataset.model)
        .where(dataset.owner_column == str(owner), key > (after or ""))
        .order_by(key)
        .limit(dataset.page_size + 1)
    )
    try:
        async with sessions(info={"owner_user_id": str(owner)}) as session:
            rows = list(await session.scalars(query))
            records = tuple(
                dataset.record.model_validate(row, from_attributes=True)
                for row in rows[: dataset.page_size]
            )
            if dataset.validate is not None:
                for record in records:
                    await dataset.validate(session, record)
    except ValidationError:
        raise blocked("migration_project_history_invalid") from None
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
        next_cursor=dataset.key_for(records[-1]) if len(rows) > dataset.page_size else None,
    )


async def ingest(sessions, dataset, receipt_model, batch):
    owner = str(batch.owner_id)
    ids = [dataset.key_for(record) for record in batch.records]
    if ids != sorted(set(ids)) or len(ids) > dataset.page_size:
        raise HTTPException(422, {"code": "migration_record_order_invalid"})
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(session, receipt_model, receipt):
            return receipt
        for record in batch.records:
            if dataset.project is not None:
                project = await session.get(dataset.project, record.project_id)
                if project is None or project.owner_user_id != owner:
                    raise blocked("migration_project_owner_conflict")
            if dataset.validate is not None:
                await dataset.validate(session, record)
            values = record.model_dump()
            if dataset.owns_record:
                values["owner_user_id"] = owner
            session.add(dataset.model(**values))
            if dataset.projection is not None:
                linked = dataset.projection(owner, record)
                if linked is not None:
                    session.add(linked)
        record_receipt(session, receipt_model, receipt)
        try:
            await session.commit()
        except IntegrityError:
            raise blocked("migration_project_history_overlap") from None
    return receipt


def mount_project_history(app, plan, sessions, prefix, datasets, receipt_model, *, source=None):
    for dataset in datasets:
        mount_dataset(
            app,
            prefix=f"{prefix}/{dataset.suffix}",
            plan=plan,
            cursor_pattern=dataset.cursor_pattern,
            batch_model=dataset.batch,
            page_model=dataset.page,
            inventory=partial(inventory, sessions, plan, dataset),
            page=partial(read_page, sessions, plan, dataset),
            ingest=partial(ingest, sessions, dataset, receipt_model) if source is None else None,
            source=source,
        )


def add_maintenance_options(parser):
    from pathlib import Path

    parser.add_argument("--migration-plan", type=Path)
    parser.add_argument("--legacy-db", type=Path)


def handle_maintenance(parser, options, export, ingest):
    import uvicorn

    from .migration_batches import MigrationPlan

    if not options.command.startswith("migration-"):
        if options.migration_plan is not None or options.legacy_db is not None:
            parser.error("迁移计划与源快照仅用于维护入口")
        return False
    if options.migration_plan is None or (
        (options.command == "migration-export") != (options.legacy_db is not None)
    ):
        parser.error("维护入口需要迁移计划，仅导出入口接受源快照")
    try:
        plan = MigrationPlan.read(options.migration_plan)
        app = (
            export(plan=plan, source_path=options.legacy_db)
            if options.legacy_db is not None
            else ingest(plan=plan, state_root=options.state_root)
        )
    except (OSError, ValueError):
        parser.error("迁移计划、隔离目录或源快照无效")
    uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)
    return True
