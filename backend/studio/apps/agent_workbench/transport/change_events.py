"""Encode detached history notifications using the existing SSE protocol."""

import asyncio
import json
from dataclasses import asdict

from studio.apps.agent_workbench.use_cases.history_subscription import HistorySubscription


async def stream_events(request, principal, after, session_id=None, *, changes, authorizer):
    subscription = HistorySubscription(
        changes,
        authorize=lambda: authorizer(request, principal),
        disconnected=request.is_disconnected,
        pause=lambda: asyncio.sleep(1),
    )
    async for event in subscription.stream(principal.user_id, after, session_id):
        if event.kind == "change":
            yield (
                f"id: {event.change.sequence}\nevent: change\n"
                f"data: {json.dumps(asdict(event.change))}\n\n"
            )
        elif event.kind == "auth_expired":
            yield 'event: auth_expired\ndata: {"kind":"auth_expired","sequence":0}\n\n'
        else:
            yield f": {event.kind}\n\n"
