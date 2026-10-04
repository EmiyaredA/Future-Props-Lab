"""Bounded entity storage, reversible journals and portable snapshots."""

from copy import deepcopy

from sqlalchemy import delete, func, select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge_tools.references import index_table_references
from app.runtime.ids import new_id

from .models import DataAsset, DataChange, DataField, DataRecord, DataTable, DataView
from .schemas import FieldSpec, RecordSpec, Snapshot, TableSpec, ViewSpec


async def snapshot(session, note_id, *, include_records=True):
    tables = list(
        await session.scalars(
            select(DataTable)
            .where(DataTable.note_id == note_id)
            .order_by(DataTable.position, DataTable.id)
        )
    )
    ids = [t.id for t in tables]
    fields = list(
        await session.scalars(
            select(DataField)
            .where(DataField.table_id.in_(ids))
            .order_by(DataField.position, DataField.id)
        )
    )
    views = list(
        await session.scalars(
            select(DataView)
            .where(DataView.table_id.in_(ids))
            .order_by(DataView.position, DataView.id)
        )
    )
    records = (
        list(
            await session.scalars(
                select(DataRecord)
                .where(DataRecord.table_id.in_(ids))
                .order_by(DataRecord.position, DataRecord.id)
            )
        )
        if include_records
        else []
    )
    return Snapshot(
        tables=[
            TableSpec(
                id=t.id,
                name=t.name,
                position=t.position,
                fields=[FieldSpec.model_validate(f) for f in fields if f.table_id == t.id],
                views=[ViewSpec.model_validate(v) for v in views if v.table_id == t.id],
            )
            for t in tables
        ],
        records={
            t.id: [RecordSpec.model_validate(r) for r in records if r.table_id == t.id]
            for t in tables
        },
    )


def entities(state):
    result = {}
    for t in state.tables:
        result["table:" + t.id] = t.model_dump(mode="json")
        for r in state.records.get(t.id, []):
            result["record:" + t.id + ":" + r.id] = r.model_dump(mode="json")
    return result


def changes(before, after):
    old, new = entities(before), entities(after)
    return [
        {"key": k, "before": old.get(k), "after": new.get(k)}
        for k in sorted(old.keys() | new.keys())
        if old.get(k) != new.get(k)
    ]


async def persist(session, note_id, before, after):
    old_tables = {t.id: t for t in before.tables}
    new_tables = {t.id: t for t in after.tables}
    for id in old_tables.keys() - new_tables.keys():
        await session.execute(
            delete(DataTable).where(DataTable.id == id, DataTable.note_id == note_id)
        )
    for t in after.tables:
        previous = old_tables.get(t.id)
        if previous != t:
            # A spec owns its complete fields and views; records remain independent.
            await session.merge(
                DataTable(id=t.id, note_id=note_id, name=t.name, position=t.position)
            )
            await session.flush()
            await session.execute(delete(DataField).where(DataField.table_id == t.id))
            await session.execute(delete(DataView).where(DataView.table_id == t.id))
            session.add_all(DataField(table_id=t.id, **f.model_dump(mode="json")) for f in t.fields)
            session.add_all(DataView(table_id=t.id, **v.model_dump(mode="json")) for v in t.views)
        old = {r.id: r for r in before.records.get(t.id, [])}
        new = {r.id: r for r in after.records.get(t.id, [])}
        if removed := old.keys() - new.keys():
            await session.execute(
                delete(DataRecord).where(DataRecord.table_id == t.id, DataRecord.id.in_(removed))
            )
        for r in new.values():
            if old.get(r.id) != r:
                await session.merge(DataRecord(table_id=t.id, **r.model_dump(mode="json")))
    await session.flush()

    await index_table_references(session, note_id, after)


def asset_ids(state):
    result = set()
    for t in state.tables:
        fields = {f.id for f in t.fields if f.type == "attachment"}
        for r in state.records.get(t.id, []):
            result.update(a for f in fields for a in r.values.get(f, []) or [])
    return result


async def journal(session, note, before, after, author_id=None, checkpoint=False):
    count = (
        await session.scalar(
            select(func.count()).select_from(DataChange).where(DataChange.note_id == note.id)
        )
        or 0
    )
    session.add(
        DataChange(
            note_id=note.id,
            revision=note.revision,
            changes=changes(before, after),
            checkpoint=after.model_dump(mode="json") if checkpoint or count % 100 == 0 else None,
            author_id=author_id,
        )
    )
    # Retain attachments referenced by any historical state until permanent deletion.
    existing = set(
        await session.scalars(select(DataAsset.asset_id).where(DataAsset.note_id == note.id))
    )
    session.add_all(DataAsset(note_id=note.id, asset_id=a) for a in asset_ids(after) - existing)
    await session.flush()


async def historical(session, note_id, revision):
    anchor = await session.scalar(
        select(DataChange)
        .where(
            DataChange.note_id == note_id,
            DataChange.revision <= revision,
            DataChange.checkpoint.is_not(None),
        )
        .order_by(DataChange.revision.desc())
        .limit(1)
    )
    if anchor is None or anchor.checkpoint is None:
        raise ThoughtError("表格历史不存在", 404, "not_found")
    state = entities(Snapshot.model_validate(anchor.checkpoint))
    rows = await session.scalars(
        select(DataChange)
        .where(
            DataChange.note_id == note_id,
            DataChange.revision > anchor.revision,
            DataChange.revision <= revision,
        )
        .order_by(DataChange.revision)
    )
    for row in rows:
        for c in row.changes:
            if c["after"] is None:
                state.pop(c["key"], None)
            else:
                state[c["key"]] = deepcopy(c["after"])
    tables = sorted(
        [TableSpec.model_validate(v) for k, v in state.items() if k.startswith("table:")],
        key=lambda t: (t.position, t.id),
    )
    return Snapshot(
        tables=tables,
        records={
            t.id: sorted(
                [
                    RecordSpec.model_validate(v)
                    for k, v in state.items()
                    if k.startswith("record:" + t.id + ":")
                ],
                key=lambda r: (r.position, r.id),
            )
            for t in tables
        },
    )


async def initialize(session, note):
    fields = [
        FieldSpec(
            id=new_id(),
            name=name,
            type=kind,
            position=i,
            options=[{"id": new_id(), "label": label} for label in ["待开始", "进行中", "已完成"]]
            if kind == "single"
            else [],
        )
        for i, (name, kind) in enumerate(
            [("名称", "text"), ("状态", "single"), ("截止日期", "date"), ("备注", "text")]
        )
    ]
    table = TableSpec(
        id=new_id(),
        name="数据表 1",
        position=0,
        fields=fields,
        views=[ViewSpec(id=new_id(), name="表格", position=0)],
    )
    empty = Snapshot(tables=[], records={})
    state = Snapshot(tables=[table], records={table.id: []})
    await persist(session, note.id, empty, state)
    await journal(session, note, empty, state, checkpoint=True)
