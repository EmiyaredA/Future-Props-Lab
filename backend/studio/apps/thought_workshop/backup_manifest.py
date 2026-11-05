"""Collect the versioned backup manifest using only Thought-owned records."""

from sqlalchemy import select

from studio.apps.thought_workshop.history_archive import export_history
from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.knowledge_tools.archive import export_tools
from studio.apps.thought_workshop.multitable.archive import archive_assets, export_tables
from studio.apps.thought_workshop.notes import Notes, note_out
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.storage.models import ThoughtNote

FORMAT = "thought-workshop-backup"


async def collect_backup(notes: Notes, knowledge_base_id: str | None):
    knowledge = KnowledgeBases(notes.session, notes.owner_user_id)
    projects = (
        [await knowledge.output(await knowledge.get(knowledge_base_id, include_deleted=True))]
        if knowledge_base_id
        else [*await knowledge.list(), *await knowledge.list(trash=True)]
    )
    project_ids = [p.id for p in projects]
    rows = (
        await notes.session.scalars(
            select(ThoughtNote)
            .where(
                ThoughtNote.owner_user_id == notes.owner_user_id,
                ThoughtNote.knowledge_base_id.in_(project_ids),
            )
            .order_by(ThoughtNote.id)
        )
    ).all()
    documents = [note_out(row).model_dump(mode="json") for row in rows]
    history = await export_history(notes.session, [row.id for row in rows])
    tools = await export_tools(
        notes.session, notes.owner_user_id, [row.id for row in rows], knowledge_base_id is None
    )
    multitables = await export_tables(notes.session, rows)
    ids = archive_assets(multitables)
    ids.update(asset_id for doc in documents for asset_id in file_ids(doc["document"]))
    ids.update(asset_id for record in history for asset_id in file_ids(record["document"]))
    ids.update(asset for template in tools["templates"] for asset in file_ids(template["document"]))
    ids.update(
        asset
        for template in tools["templates"]
        if template.get("multitable")
        for asset in archive_assets({"template": {"state": template["multitable"]}})
    )
    ids.update(p.cover_asset_id for p in projects if p.cover_asset_id)
    payload = {
        "format": FORMAT,
        "version": 9,
        "multitables": multitables,
        **tools,
        "history": history,
        "knowledge_bases": [r.model_dump(mode="json") for r in projects],
        "folders": [],
        "notes": documents,
    }
    return payload, ids
