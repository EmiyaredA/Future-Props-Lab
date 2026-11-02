"""Durable invalidation streams. Reauthorize every batch, with no request-long DB session."""

import asyncio
import json

from fastapi import HTTPException
from sqlalchemy import select

from app.console.models import AuthSession, User
from app.runtime.db import SessionLocal
from app.runtime.ownership import bind_owner
from app.runtime.time import utc_now

from .models import WorkbenchChange
from .reading import change_cursor, get_conversation


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


async def valid_auth(db, principal):
    if not principal.session_id:
        return False
    row = (
        await db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.id == principal.session_id, User.id == principal.user_id)
        )
    ).first()
    if not row:
        return False
    auth, user = row
    now = utc_now()
    return (
        user.status == "active"
        and not user.must_change_password
        and auth.revoked_at is None
        and auth.idle_expires_at > now
        and auth.absolute_expires_at > now
    )


async def stream_events(request, principal, after, session_id=None, sessions=SessionLocal):
    owner = principal.user_id
    yield ": connected\n\n"
    while not await request.is_disconnected():
        async with sessions() as db:
            bind_owner(db, owner)
            if not await valid_auth(db, principal):
                yield 'event: auth_expired\ndata: {"kind":"auth_expired","sequence":0}\n\n'
                return
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
