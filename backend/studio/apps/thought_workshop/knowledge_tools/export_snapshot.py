from sqlalchemy import select, text

from studio.apps.thought_workshop.content_exports import resolve_assets
from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.knowledge_tools.schemas import LibraryExportSnapshot
from studio.apps.thought_workshop.multitable.content import project as project_content
from studio.apps.thought_workshop.notes import note_out
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.storage.models import ThoughtNote


async def export_snapshot(session, owner_user_id, project_id):
    # sqlite3's legacy mode does not begin a transaction for SELECT. Start an
    # explicit read snapshot so metadata, documents and assets share one view.
    await session.rollback()
    await session.execute(text("BEGIN"))
    knowledge = KnowledgeBases(session, owner_user_id)
    project = await knowledge.get(project_id)
    output = await knowledge.output(project)
    rows = list(
        await session.scalars(
            select(ThoughtNote)
            .where(
                ThoughtNote.owner_user_id == owner_user_id,
                ThoughtNote.knowledge_base_id == project_id,
                ThoughtNote.deleted_at.is_(None),
            )
            .order_by(ThoughtNote.position, ThoughtNote.id)
        )
    )
    ids = {asset for row in rows for asset in file_ids(row.document)}
    if project.cover_asset_id:
        ids.add(project.cover_asset_id)
    await resolve_assets(session, owner_user_id, ids)
    value = LibraryExportSnapshot(
        knowledge_base=output.model_dump(mode="json"),
        documents=[
            {
                **note_out(row).model_dump(mode="json"),
                "kind": "note",
                "document": await project_content(session, owner_user_id, row),
            }
            for row in rows
        ],
        asset_ids=sorted(ids),
    )
    await session.rollback()
    return value
