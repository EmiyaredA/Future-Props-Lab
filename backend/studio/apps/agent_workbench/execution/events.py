"""Reconnecting clients reload the persisted transcript on each revision change."""

import asyncio
import json

from studio.apps.agent_workbench.events import valid_auth
from studio.apps.agent_workbench.execution.storage import get_chat, latest_turn_version


async def stream(request, principal, chat_id, ready=None, *, sessions):
    previous = None
    owner = principal.user_id
    while not await request.is_disconnected():
        async with sessions() as db:
            if not await valid_auth(db, principal):
                break
            await get_chat(db, owner, chat_id)
            version = await latest_turn_version(db, owner, chat_id)
        if ready:
            version = (version, ready(owner, chat_id))
        if version != previous:
            previous = version
            yield f"event: change\ndata: {json.dumps(version)}\n\n"
        else:
            yield ": heartbeat\n\n"
        await asyncio.sleep(0.6)
    yield "event: auth_expired\ndata: {}\n\n"
