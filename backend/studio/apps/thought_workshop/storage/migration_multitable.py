"""Preserve native multitable entity IDs, journals and retained attachments."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field
from sqlalchemy import select

from studio.apps.thought_workshop.knowledge_tools.models import ThoughtDocumentReference
from studio.apps.thought_workshop.multitable.models import (
    DataAsset,
    DataChange,
    DataField,
    DataRecord,
    DataTable,
    DataView,
)
from studio.apps.thought_workshop.multitable.schemas import CellValue, FieldType
from studio.apps.thought_workshop.storage.models import ThoughtNote
from studio.contracts.management.project_history import HistoryRecord, Identifier

ENTITY = r"[a-zA-Z0-9_-]{1,36}"
EntityId = Annotated[str, Field(pattern=f"^{ENTITY}$")]
TABLE_CHILDREN = {DataField, DataView, DataRecord}
NOTE_CHILDREN = {DataTable, DataChange, DataAsset}


class Table(HistoryRecord):
    id: EntityId
    note_id: Identifier
    name: str
    position: int = Field(ge=0)
    groups: list[dict]


class TableChild(HistoryRecord):
    id: EntityId
    table_id: EntityId
    position: int = Field(ge=0)


class Column(TableChild):
    name: str
    type: FieldType
    options: list[dict]
    config: dict


class View(TableChild):
    name: str
    type: Literal["grid", "kanban", "calendar"]
    config: dict


class Record(TableChild):
    values: dict[str, CellValue]


class Change(HistoryRecord):
    id: Identifier
    note_id: Identifier
    revision: int = Field(ge=0)
    changes: list[dict]
    checkpoint: dict | None
    author_id: Identifier | None
    created_at: datetime


class Attachment(HistoryRecord):
    cursor: str
    note_id: Identifier
    asset_id: Identifier


async def table_note(db, model, record):
    if model in NOTE_CHILDREN:
        return await db.get(ThoughtNote, record.note_id)
    if model in TABLE_CHILDREN:
        table = await db.get(DataTable, record.table_id)
        return await db.get(ThoughtNote, table.note_id) if table is not None else None
    return None


async def record_note_links(db, note, record):
    fields = set(
        await db.scalars(
            select(DataField.id).where(
                DataField.table_id == record.table_id, DataField.type == "note"
            )
        )
    )
    targets = {
        target
        for key, cell in record.values.items()
        if key in fields and isinstance(cell, list)
        for target in cell
    }
    if not targets:
        return
    previous = await db.scalars(
        select(ThoughtDocumentReference.target_id).where(
            ThoughtDocumentReference.note_id == note.id,
            ThoughtDocumentReference.target_id.in_(targets),
        )
    )
    db.add_all(
        ThoughtDocumentReference(note_id=note.id, target_id=target)
        for target in sorted(targets - set(previous))
    )
