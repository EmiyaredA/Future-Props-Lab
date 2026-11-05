"""Verify durable Thought document relationships after the final batch."""

import hashlib

from sqlalchemy import select, text

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtDocumentReference,
    ThoughtTemplateAsset,
)
from studio.apps.thought_workshop.knowledge_tools.references import reference_ids
from studio.apps.thought_workshop.multitable.models import DataAsset
from studio.apps.thought_workshop.multitable.storage import asset_ids, historical, snapshot
from studio.apps.thought_workshop.storage.models import (
    ThoughtHistoryAsset,
    ThoughtNote,
    ThoughtNoteAsset,
)

from .migration_documents import conflict

INVALID_GRAPH = """
SELECT 1 FROM thought_knowledge_bases AS book
LEFT JOIN thought_notes AS home ON home.id = book.home_note_id
WHERE home.id IS NULL OR home.knowledge_base_id != book.id
   OR home.owner_user_id != book.owner_user_id OR NOT home.is_home
   OR home.parent_id IS NOT NULL OR home.deleted_at IS NOT NULL OR home.kind != 'note'
UNION ALL
SELECT 1 FROM thought_notes AS note
LEFT JOIN thought_knowledge_bases AS book ON book.id = note.knowledge_base_id
LEFT JOIN thought_notes AS parent ON parent.id = note.parent_id
WHERE book.id IS NULL OR note.owner_user_id != book.owner_user_id
   OR note.is_home != (note.id = book.home_note_id)
   OR (note.parent_id IS NOT NULL AND (
       parent.id IS NULL OR parent.knowledge_base_id != book.id
       OR parent.owner_user_id != note.owner_user_id OR parent.is_home
   ))
UNION ALL
SELECT 1 FROM thought_document_references AS reference
JOIN thought_notes AS origin ON origin.id = reference.note_id
JOIN thought_notes AS target ON target.id = reference.target_id
WHERE origin.owner_user_id != target.owner_user_id
LIMIT 1
"""


ASSET_LINKS = {
    "note_assets": (ThoughtNoteAsset.note_id, ThoughtNoteAsset.asset_id),
    "history_assets": (ThoughtHistoryAsset.history_id, ThoughtHistoryAsset.asset_id),
    "table_assets": (DataAsset.note_id, DataAsset.asset_id),
    "template_assets": (ThoughtTemplateAsset.template_id, ThoughtTemplateAsset.asset_id),
}


async def link_digest(db, parent, asset):
    digest = hashlib.sha256()
    count = 0
    records = await db.stream(
        select(parent, asset).order_by(parent, asset).execution_options(yield_per=128)
    )
    async for parent_id, asset_id in records:
        digest.update(f"{parent_id}/{asset_id}\n".encode())
        count += 1
    return {"record_count": count, "sha256": digest.hexdigest()}


async def relationship_inventory(sessions):
    digest = hashlib.sha256()
    count = 0
    async with sessions(info={"allow_system_reads": True}) as db:
        if await db.scalar(text(INVALID_GRAPH)) is not None:
            raise conflict("migration_thought_document_tree_invalid")
        cursor = await db.stream(
            select(ThoughtNote.id, ThoughtNote.document, ThoughtNote.kind, ThoughtNote.revision)
            .order_by(ThoughtNote.id)
            .execution_options(yield_per=32)
        )
        async for identifier, document, kind, revision in cursor:
            if kind == "multitable":
                table = await snapshot(db, identifier)
                try:
                    historical_table = await historical(db, identifier, revision)
                except ThoughtError:
                    raise conflict("migration_thought_table_history_invalid") from None
                if table != historical_table:
                    raise conflict("migration_thought_table_history_invalid")
                expected = {
                    target
                    for spec in table.tables
                    for field in spec.fields
                    if field.type == "note"
                    for record in table.records[spec.id]
                    for target in record.values.get(field.id, []) or []
                }
                retained = await db.scalars(
                    select(DataAsset.asset_id).where(DataAsset.note_id == identifier)
                )
                if not asset_ids(table) <= set(retained):
                    raise conflict("migration_thought_table_assets_invalid")
            else:
                expected = reference_ids(document)
            stored = set(
                await db.scalars(
                    select(ThoughtDocumentReference.target_id).where(
                        ThoughtDocumentReference.note_id == identifier
                    )
                )
            )
            if expected != stored:
                raise conflict("migration_thought_document_reference_invalid")
            for target in sorted(stored):
                digest.update(f"{identifier}/{target}\n".encode())
                count += 1
        files = {
            name: await link_digest(db, parent, asset)
            for name, (parent, asset) in ASSET_LINKS.items()
        }
    return {"record_count": count, "sha256": digest.hexdigest(), "file_links": files}
