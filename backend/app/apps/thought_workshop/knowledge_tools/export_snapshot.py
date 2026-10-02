from sqlalchemy import select, text

from app.apps.thought_workshop.content_exports import resolve_assets
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.models import ThoughtNote
from app.apps.thought_workshop.notes import note_out
from app.apps.thought_workshop.schemas.document import file_ids

from .schemas import LibraryExportSnapshot


async def export_snapshot(session, workspace_id, project_id):
    # sqlite3's legacy mode does not begin a transaction for SELECT. Start an
    # explicit read snapshot so metadata, documents and assets share one view.
    await session.rollback()
    await session.execute(text("BEGIN"))
    knowledge = KnowledgeBases(session, workspace_id)
    project = await knowledge.get(project_id)
    output = await knowledge.output(project)
    rows = list(
        await session.scalars(
            select(ThoughtNote)
            .where(
                ThoughtNote.workspace_id == workspace_id,
                ThoughtNote.knowledge_base_id == project_id,
                ThoughtNote.deleted_at.is_(None),
            )
            .order_by(ThoughtNote.position, ThoughtNote.id)
        )
    )
    ids = {asset for row in rows for asset in file_ids(row.document)}
    if project.cover_asset_id:
        ids.add(project.cover_asset_id)
    await resolve_assets(session, workspace_id, ids)
    value = LibraryExportSnapshot(
        knowledge_base=output.model_dump(mode="json"),
        documents=[note_out(row).model_dump(mode="json") for row in rows],
        asset_ids=sorted(ids),
    )
    await session.rollback()
    return value
