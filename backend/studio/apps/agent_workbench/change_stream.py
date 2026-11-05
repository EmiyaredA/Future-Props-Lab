"""Account-scoped change stream with explicit live authorization and storage."""

import asyncio
import json

from fastapi import HTTPException
from sqlalchemy import select

from studio.apps.agent_workbench.reading import change_cursor, get_conversation
from studio.apps.agent_workbench.storage.models import WorkbenchChange
from studio.runtime.database.ownership import bind_owner


async def event_page(db, owner, after, session_id=None):
    if session_id:
        await get_conversation(db, owner, session_id)
    latest = await change_cursor(db, owner)
    if after > latest:
        return [{"sequence": latest, "kind": "reset", "session_id": session_id}]
    query = select(WorkbenchChange).where(
        WorkbenchChange.owner_user_id == owner, WorkbenchChange.id > after
    )
    if session_id:
        query = query.where(WorkbenchChange.session_id == session_id)
    rows = (await db.scalars(query.order_by(WorkbenchChange.id).limit(201))).all()
    if len(rows) > 200:
        return [{"sequence": latest, "kind": "reset", "session_id": session_id}]
    return [{"sequence": row.id, "kind": row.kind, "session_id": row.session_id} for row in rows]


async def stream_events(request, principal, after, session_id=None, *, sessions, authorizer):
    owner = principal.user_id
    yield ": connected\n\n"
    while not await request.is_disconnected():
        if not await authorizer(request, principal):
            yield 'event: auth_expired\ndata: {"kind":"auth_expired","sequence":0}\n\n'
            return
        async with sessions() as db:
            bind_owner(db, owner)
            try:
                events = await event_page(db, owner, after, session_id)
            except HTTPException:
                return
        for event in events:
            after = event["sequence"]
            yield f"id: {after}\nevent: change\ndata: {json.dumps(event)}\n\n"
        if not events:
            yield ": heartbeat\n\n"
        await asyncio.sleep(1)
