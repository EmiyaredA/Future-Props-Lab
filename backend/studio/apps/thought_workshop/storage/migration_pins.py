"""Project legacy document and cover references for the Assets transfer."""

from collections import defaultdict
from functools import partial
from uuid import uuid5

from fastapi import HTTPException
from sqlalchemy import func, select

from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from studio.apps.thought_workshop.multitable.archive import archive_assets, export_tables
from studio.apps.thought_workshop.multitable.models import DataAsset
from studio.apps.thought_workshop.multitable.schemas import Snapshot
from studio.apps.thought_workshop.multitable.storage import asset_ids
from studio.apps.thought_workshop.publication.models import Publication
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.storage.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
)
from studio.contracts.thought_workshop.migration import (
    PIN_CURSOR,
    PIN_KINDS,
    ThoughtPinBatch,
    ThoughtPinPage,
    ThoughtPins,
    pin_path,
)
from studio.runtime.database.migration_apps import mount_dataset

MODELS = {
    "knowledge-base": ThoughtKnowledgeBase,
    "note": ThoughtNote,
    "template": ThoughtTemplate,
    "publication": Publication,
}


def conflict():
    return HTTPException(409, {"code": "migration_thought_reference_conflict"})


async def validated_book(db, row):
    book = await db.get(ThoughtKnowledgeBase, row.knowledge_base_id)
    if book is None or book.owner_user_id != row.owner_user_id:
        raise conflict()


async def note_pins(db, row):
    await validated_book(db, row)
    retained = file_ids(row.document)
    current = await db.scalars(
        select(ThoughtNoteAsset.asset_id).where(ThoughtNoteAsset.note_id == row.id)
    )
    if set(current) != retained:
        raise conflict()
    links = defaultdict(set)
    historical = await db.execute(
        select(ThoughtHistoryAsset.history_id, ThoughtHistoryAsset.asset_id)
        .join(ThoughtNoteHistory, ThoughtNoteHistory.id == ThoughtHistoryAsset.history_id)
        .where(ThoughtNoteHistory.note_id == row.id)
    )
    for version, asset in historical:
        links[version].add(asset)
    history = await db.stream(
        select(ThoughtNoteHistory.id, ThoughtNoteHistory.document)
        .where(ThoughtNoteHistory.note_id == row.id)
        .execution_options(yield_per=1)
    )
    async for version, document in history:
        pinned = links.pop(version, set())
        if pinned != file_ids(document):
            raise conflict()
        retained.update(pinned)
    table_links = set(
        await db.scalars(select(DataAsset.asset_id).where(DataAsset.note_id == row.id))
    )
    if (
        row.kind == "multitable"
        and not archive_assets(await export_tables(db, [row])) <= table_links
    ):
        raise conflict()
    retained.update(table_links)
    return retained


def template_files(row):
    expected = file_ids(row.document)
    if row.multitable is not None:
        expected |= asset_ids(Snapshot.model_validate(row.multitable))
    return expected


async def template_pins(db, row):
    expected = template_files(row)
    stored = await db.scalars(
        select(ThoughtTemplateAsset.asset_id).where(ThoughtTemplateAsset.template_id == row.id)
    )
    if set(stored) != expected:
        raise conflict()
    return expected


async def project(db, kind, row):
    if kind == "note":
        assets = await note_pins(db, row)
    elif kind == "template":
        assets = await template_pins(db, row)
    else:
        if kind == "publication":
            await validated_book(db, row)
        assets = {row.cover_asset_id} if row.cover_asset_id else set()
    return ThoughtPins(id=row.id, revision=row.revision, asset_ids=sorted(assets))


async def inventory(sessions, plan, model):
    async with sessions() as db:
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


async def page(sessions, plan, dataset, kind, model, owner, after):
    async with sessions() as db:
        rows = list(
            await db.scalars(
                select(model)
                .where(model.owner_user_id == str(owner), model.id > (after or ""))
                .order_by(model.id)
                .limit(2)
            )
        )
        records = tuple([await project(db, kind, row) for row in rows[:1]])
    batch = ThoughtPinBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset}/{owner}/{after or ''}"),
        records=records,
    )
    return ThoughtPinPage(
        batch=batch, sha256=batch.digest, next_cursor=records[0].id if len(rows) > 1 else None
    )


def mount_legacy_pins(app, plan, sessions, source):
    for dataset, kind in PIN_KINDS.items():
        model = MODELS[kind]
        mount_dataset(
            app,
            prefix=pin_path(dataset),
            plan=plan,
            cursor_pattern=PIN_CURSOR,
            batch_model=ThoughtPinBatch,
            page_model=ThoughtPinPage,
            inventory=partial(inventory, sessions, plan, model),
            page=partial(page, sessions, plan, dataset, kind, model),
            source=source,
        )
