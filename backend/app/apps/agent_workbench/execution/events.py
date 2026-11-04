"""Reconnecting clients reload the persisted transcript on each revision change."""

import asyncio
import json

from app.runtime.db import SessionLocal

from ..events import valid_auth
from .storage import get_chat, recent_turns


async def stream(request, principal, chat_id):
    previous = None
    owner = principal.user_id
    while not await request.is_disconnected():
        async with SessionLocal() as db:
            if not await valid_auth(db, principal):
                break
            await get_chat(db, owner, chat_id)
            turns = await recent_turns(db, owner, chat_id, 1)
            version = (turns[0].id, turns[0].revision) if turns else ()
        if version != previous:
            previous = version
            yield f"event: change\ndata: {json.dumps(version)}\n\n"
        else:
            yield ": heartbeat\n\n"
        await asyncio.sleep(0.6)
    yield "event: auth_expired\ndata: {}\n\n"
