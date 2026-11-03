"""Document-scoped atomic operations. Routes never own persistence or transactions."""

from copy import deepcopy

from sqlalchemy import select, update

from app.apps.thought_workshop.asset_metadata import metadata
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
from app.apps.thought_workshop.notes import Notes
from app.apps.thought_workshop.publication.lifecycle import touch_note
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

from . import query as queries
from .models import DataChange, DataField, DataRecord, DataTable, DataView
from .query import active_members, person_ids
from .schemas import BatchOut, ConversionOut, Structure
from .storage import asset_ids, historical, journal, persist, snapshot
from .validation import convert_records, validate_snapshot, validate_table


class Multitable:
    def __init__(self, session, owner_user_id, author_id=None):
        self.session, self.owner_user_id, self.author_id = session, owner_user_id, author_id

    async def note(self, note_id):
        n = await Notes(self.session, self.owner_user_id).get(note_id)
        if n.kind != "multitable" or n.deleted_at:
            raise ThoughtError("多维表格不存在", 404, "not_found")
        return n

    async def structure(self, note_id, role="edit"):
        n = await self.note(note_id)
        state = await snapshot(self.session, note_id, include_records=False)
        return Structure(
            note_id=note_id,
            revision=n.revision,
            tables=state.tables,
            role=role,
            can_edit=role in {"edit", "manage"},
            can_manage=role == "manage",
        )

    async def table(self, note_id, table_id):
        structure = await self.structure(note_id)
        table = next((t for t in structure.tables if t.id == table_id), None)
        if table is None:
            raise ThoughtError("数据表不存在", 404, "not_found")
        return table, structure.revision

    async def records(self, note_id, table_id, query):
        table, revision = await self.table(note_id, table_id)
        return await queries.records(self.session, table, query, revision, self.owner_user_id)

    async def conversion(self, note_id, body):
        before = await snapshot(self.session, (await self.note(note_id)).id)
        old = next((t for t in before.tables if t.id == body.table.id), None)
        if old is None:
            raise ThoughtError("数据表不存在", 404, "not_found")
        validate_table(body.table, old)
        rows = deepcopy(before.records[old.id])
        errors = convert_records(body.table, rows, old)
        original = {r.id: r.values for r in before.records[old.id]}
        samples = []
        for r in rows:
            for id in original[r.id].keys() | r.values.keys():
                if original[r.id].get(id) != r.values.get(id):
                    samples.append(
                        {
                            "record_id": r.id,
                            "field_id": id,
                            "before": original[r.id].get(id),
                            "after": r.values.get(id),
                        }
                    )
                    if len(samples) >= 20:
                        break
            if len(samples) >= 20:
                break
        return ConversionOut(
            valid=not errors, errors=errors[:200], affected_records=len(rows), samples=samples
        )

    async def reserve(self, n, expected):
        note_id = n.id
        result = await self.session.execute(
            update(ThoughtNote)
            .where(
                ThoughtNote.id == n.id,
                ThoughtNote.owner_user_id == self.owner_user_id,
                ThoughtNote.deleted_at.is_(None),
                ThoughtNote.revision == expected,
            )
            .values(revision=expected + 1, updated_at=utc_now())
        )
        if result.rowcount != 1:
            await self.session.rollback()
            structure = await self.structure(note_id)
            current = await snapshot(self.session, note_id)
            raise RevisionConflictError(
                expected,
                structure.revision,
                {
                    "structure": structure.model_dump(mode="json"),
                    "records": current.model_dump(mode="json")["records"],
                },
            )
        return await self.note(n.id)

    async def validate_refs(self, state, before):
        ids = asset_ids(state)
        if ids:
            await metadata(self.session, self.owner_user_id).describe(ids)

        def notes(s):
            return {
                id
                for t in s.tables
                for f in t.fields
                if f.type == "note"
                for r in s.records.get(t.id, [])
                for id in r.values.get(f.id, []) or []
            }

        refs = notes(state) - notes(before)
        if refs:
            found = set(
                await self.session.scalars(
                    select(ThoughtNote.id).where(
                        ThoughtNote.id.in_(refs),
                        ThoughtNote.owner_user_id == self.owner_user_id,
                        ThoughtNote.deleted_at.is_(None),
                    )
                )
            )
            if refs != found:
                raise ThoughtError("引用文档不存在或不可访问", 404, "not_found")
        # Submitted IDs cannot replace another document's entities through ORM merge.
        for model, new_ids, old_ids in [
            (DataTable, {t.id for t in state.tables}, {t.id for t in before.tables}),
            (
                DataField,
                {f.id for t in state.tables for f in t.fields},
                {f.id for t in before.tables for f in t.fields},
            ),
            (
                DataView,
                {v.id for t in state.tables for v in t.views},
                {v.id for t in before.tables for v in t.views},
            ),
            (
                DataRecord,
                {r.id for rows in state.records.values() for r in rows},
                {r.id for rows in before.records.values() for r in rows},
            ),
        ]:
            if new_ids - old_ids and await self.session.scalar(
                select(model.id).where(model.id.in_(new_ids - old_ids)).limit(1)
            ):
                raise ThoughtError("实体 ID 已被使用", 422, "invalid_id")
        # IDs already owned by this document must not be moved to another table.
        for attr in ("fields", "views"):
            owners = {x.id: t.id for t in before.tables for x in getattr(t, attr)}
            if any(
                x.id in owners and owners[x.id] != t.id
                for t in state.tables
                for x in getattr(t, attr)
            ):
                raise ThoughtError("不能跨表移动字段或视图", 422, "invalid_id")
        owners = {r.id: id for id, rows in before.records.items() for r in rows}
        if any(
            r.id in owners and owners[r.id] != id
            for id, rows in state.records.items()
            for r in rows
        ):
            raise ThoughtError("不能跨表移动记录", 422, "invalid_id")

    async def validate_people(self, before, after):
        def collect(state):
            found = set()
            for table in state.tables:
                for field in table.fields:
                    if field.type != "person":
                        continue
                    found.update(field.config.default_user_ids or [])
                    for record in state.records.get(table.id, []):
                        found.update(person_ids(record.values.get(field.id)))
            return found

        introduced = collect(after) - collect(before)
        if not introduced:
            return
        members = await active_members(self.session, introduced)
        if introduced - members.keys():
            raise ThoughtError("只能选择当前账号的成员", 422, "invalid_member")

    async def commit(self, n, expected, before, after, *, checkpoint=False, before_write=None):
        validate_snapshot(after)
        await self.validate_people(before, after)
        await self.validate_refs(after, before)
        if before_write is not None:
            note_id = n.id
            await before_write(before, after)
            n = await self.note(note_id)
        n = await self.reserve(n, expected)
        await persist(self.session, n.id, before, after)
        await journal(self.session, n, before, after, self.author_id, checkpoint)
        text = "\n".join(
            [t.name for t in after.tables]
            + [
                str(value)
                for rows in after.records.values()
                for r in rows
                for value in r.values.values()
                if value is not None
            ]
        )
        await self.session.execute(
            update(ThoughtNote)
            .where(ThoughtNote.id == n.id)
            .values(search_text=text[: 2 * 1024 * 1024])
        )
        await self.session.execute(
            update(ThoughtKnowledgeBase)
            .where(ThoughtKnowledgeBase.id == n.knowledge_base_id)
            .values(updated_at=utc_now())
        )
        await touch_note(self.session, n.id)
        await self.session.commit()
        return BatchOut(structure=await self.structure(n.id))

    async def apply(
        self,
        note_id,
        body,
        *,
        checkpoint=False,
        allowed_assets=None,
        allowed_notes=None,
        before_write=None,
    ):
        n = await self.note(note_id)
        before = await snapshot(self.session, note_id)
        after = deepcopy(before)
        changed = {}
        for op in body.operations:
            if op.op == "table.put":
                table = op.table.model_copy(deep=True)
                old = next((t for t in after.tables if t.id == table.id), None)
                validate_table(table, old)
                rows = after.records.setdefault(table.id, [])
                errors = convert_records(table, rows, old)
                if errors:
                    raise ThoughtError(
                        "字段转换失败：" + errors[0]["message"], 422, "conversion_failed"
                    )
                after.tables = [t for t in after.tables if t.id != table.id] + [table]
            else:
                table = next((t for t in after.tables if t.id == op.table_id), None)
                if table is None:
                    raise ThoughtError("数据表不存在", 404, "not_found")
                if op.op == "table.delete":
                    after.tables = [t for t in after.tables if t.id != table.id]
                    after.records.pop(table.id, None)
                elif op.op == "records.put":
                    rows = {r.id: r for r in after.records[table.id]}
                    rows.update({r.id: r.model_copy(deep=True) for r in op.records})
                    after.records[table.id] = list(rows.values())
                    changed.setdefault(table.id, []).extend(op.records)
                else:
                    after.records[table.id] = [
                        r for r in after.records[table.id] if r.id not in op.ids
                    ]
        if allowed_assets is not None and not asset_ids(after) <= allowed_assets:
            raise ThoughtError("附件不可访问", 404, "not_found")
        if allowed_notes is not None:
            old_refs = {
                id
                for t in before.tables
                for f in t.fields
                if f.type == "note"
                for r in before.records[t.id]
                for id in r.values.get(f.id, []) or []
            }
            new_refs = {
                id
                for t in after.tables
                for f in t.fields
                if f.type == "note"
                for r in after.records[t.id]
                for id in r.values.get(f.id, []) or []
            }
            if not (new_refs - old_refs) <= allowed_notes:
                raise ThoughtError("引用文档不可访问", 404, "not_found")
        result = await self.commit(
            n,
            body.expected_revision,
            before,
            after,
            checkpoint=checkpoint,
            before_write=before_write,
        )
        result.records = changed
        return result

    async def history(self, note_id, offset=0):
        await self.note(note_id)
        return list(
            await self.session.scalars(
                select(DataChange)
                .where(DataChange.note_id == note_id)
                .order_by(DataChange.revision.desc())
                .offset(offset)
                .limit(30)
            )
        )

    async def history_snapshot(self, note_id, revision):
        n = await self.note(note_id)
        if revision < 0 or revision > n.revision:
            raise ThoughtError("表格历史不存在", 404, "not_found")
        return await historical(self.session, note_id, revision)

    async def restore(self, note_id, revision, expected):
        n = await self.note(note_id)
        before = await snapshot(self.session, note_id)
        after = await self.history_snapshot(note_id, revision)
        return await self.commit(n, expected, before, after, checkpoint=True)
