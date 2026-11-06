"""History cursor recovery uses the same contract with memory and owned SQLite."""

from contextlib import aclosing

import pytest

from studio.apps.agent_workbench.storage.change_events import SqlChangeEvents
from studio.apps.agent_workbench.storage.models import WorkbenchChange
from studio.apps.agent_workbench.use_cases.history_subscription import (
    Change,
    ChangePage,
    HistorySubscription,
)
from tests.apps.agent_workbench.archive_database import open_archive


class MemoryEvents:
    async def read(self, owner, after, session_id):
        if session_id is not None:
            return None
        if owner != "alice":
            return ChangePage(0, ())
        return ChangePage(201, tuple(Change(n, "source", None) for n in range(after + 1, 202)))


@pytest.fixture(params=["memory", "sqlite"])
async def events(request, tmp_path, monkeypatch):
    if request.param == "memory":
        yield MemoryEvents()
        return
    database = open_archive(tmp_path, monkeypatch)
    try:
        async with database.sessions(info={"owner_user_id": "alice"}) as db:
            db.add_all(WorkbenchChange(owner_user_id="alice", kind="source") for _ in range(201))
            await db.commit()
        yield SqlChangeEvents(database.sessions)
    finally:
        await database.close()


@pytest.mark.parametrize("cursor", [0, 10**9])
async def test_history_cursor_reset_heartbeat_and_revocation(events, cursor):
    active = True

    async def authorize():
        return active

    async def disconnected():
        return False

    async def pause():
        pass

    subscription = HistorySubscription(
        events, authorize=authorize, disconnected=disconnected, pause=pause
    )
    async with aclosing(subscription.stream("alice", cursor)) as stream:
        assert (await anext(stream)).kind == "connected"
        reset = await anext(stream)
        assert reset.kind == "change" and reset.change == Change(201, "reset", None)
        assert (await anext(stream)).kind == "heartbeat"
        active = False
        assert (await anext(stream)).kind == "auth_expired"
        with pytest.raises(StopAsyncIteration):
            await anext(stream)


async def test_history_port_keeps_owners_separate_and_replays_after_cursor(events):
    assert await events.read("bob", 0, None) == ChangePage(0, ())
    page = await events.read("alice", 199, None)
    assert page.items == (Change(200, "source", None), Change(201, "source", None))
    assert await events.read("alice", 0, "missing-conversation") is None
