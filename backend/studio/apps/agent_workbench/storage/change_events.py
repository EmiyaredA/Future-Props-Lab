"""Read account-scoped Workbench event pages in a short storage lifetime."""

from fastapi import HTTPException
from sqlalchemy import select

from studio.apps.agent_workbench.reading import change_cursor, get_conversation
from studio.apps.agent_workbench.storage.models import WorkbenchChange
from studio.apps.agent_workbench.use_cases.history_subscription import Change, ChangePage
from studio.runtime.database.ownership import bind_owner


async def read_page(db, owner, after, session_id=None):
    if session_id:
        await get_conversation(db, owner, session_id)
    latest = await change_cursor(db, owner)
    query = select(WorkbenchChange).where(
        WorkbenchChange.owner_user_id == owner, WorkbenchChange.id > after
    )
    if session_id:
        query = query.where(WorkbenchChange.session_id == session_id)
    rows = (await db.scalars(query.order_by(WorkbenchChange.id).limit(201))).all()
    return ChangePage(latest, tuple(Change(row.id, row.kind, row.session_id) for row in rows))


class SqlChangeEvents:
    def __init__(self, sessions):
        self.sessions = sessions

    async def read(self, owner, after, session_id):
        async with self.sessions() as db:
            bind_owner(db, owner)
            try:
                return await read_page(db, owner, after, session_id)
            except HTTPException:
                # Existing conversation storage signals inaccessible resources via
                # an HTTP exception; keep that legacy detail inside this adapter.
                return None
