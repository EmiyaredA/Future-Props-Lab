"""Render Workbench updates as the existing SSE wire format."""

import asyncio
import json

from studio.apps.agent_workbench.use_cases.observe_turns import ObserveTurns


async def stream_turns(request, principal, chat_id, *, versions, authorizer):
    observer = ObserveTurns(
        versions,
        authorize=lambda: authorizer(request, principal),
        disconnected=request.is_disconnected,
        pause=lambda: asyncio.sleep(0.6),
    )
    async for event in observer.stream(principal.user_id, chat_id):
        if event.kind == "change":
            yield f"event: change\ndata: {json.dumps(event.version)}\n\n"
        elif event.kind == "heartbeat":
            yield ": heartbeat\n\n"
        else:
            yield "event: auth_expired\ndata: {}\n\n"
