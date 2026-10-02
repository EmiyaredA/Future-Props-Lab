"""Validate portable history before writes; never trust imported account identifiers."""

from copy import deepcopy
from datetime import UTC
from uuid import uuid4

from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.history import History, snapshot
from app.apps.thought_workshop.models import ThoughtNote, ThoughtNoteHistory
from app.apps.thought_workshop.schemas.document import file_ids
from app.apps.thought_workshop.schemas.history import ThoughtHistorySnapshot
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteIn


async def export_history(session, note_ids: list[str]) -> list[dict]:
    rows = (
        await session.scalars(
            select(ThoughtNoteHistory)
            .where(ThoughtNoteHistory.note_id.in_(note_ids))
            .order_by(ThoughtNoteHistory.note_id, ThoughtNoteHistory.revision)
        )
    ).all()
    return [snapshot(row).model_dump(mode="json") for row in rows]


def validate_history(payload: dict) -> None:
    records = payload.get("history", [])
    if not isinstance(records, list):
        raise ThoughtError("历史记录格式无效")
    notes = {n["id"] for n in payload["notes"]}
    assets = {a["id"] for a in payload["assets"]}
    seen = set()
    ids = set()
    for record in records:
        value = ThoughtHistorySnapshot.model_validate(record)
        key = (value.note_id, value.revision)
        if value.note_id not in notes or key in seen or value.id in ids:
            raise ThoughtError("历史记录重复或归属无效")
        if not file_ids(value.document) <= assets:
            raise ThoughtError("备份缺少历史引用文件")
        seen.add(key)
        ids.add(value.id)


async def import_history(notes, payload, inserted, note_mapping, asset_mapping, remap):
    history = History(notes.session)
    history_mapping = {}
    for record in sorted(payload.get("history", []), key=lambda item: item["revision"]):
        if record["note_id"] not in inserted:
            continue
        value = ThoughtHistorySnapshot.model_validate(record)
        note = await notes.session.get(ThoughtNote, note_mapping[value.note_id])
        document = deepcopy(value.document)
        remap(document, asset_mapping)
        body = ThoughtNoteIn(knowledge_base_id=note.knowledge_base_id, document=document)
        await notes.validate_refs(body, importing=True)
        row = ThoughtNoteHistory(
            **value.model_dump(exclude={"id", "note_id", "author_id", "document", "created_at"}),
            id=str(uuid4()),
            note_id=note.id,
            author_id=None,
            document=body.document,
            created_at=value.created_at.astimezone(UTC).replace(tzinfo=None)
            if value.created_at.tzinfo
            else value.created_at,
        )
        history_mapping[value.id] = row.id
        notes.session.add(row)
        await notes.session.flush()
        await history.references(row)
        note.revision = max(note.revision, value.revision + 1)
    for old_id in inserted:
        note = await notes.session.get(ThoughtNote, note_mapping[old_id])
        await history.append(note, notes.author_id, "import")

    return history_mapping
