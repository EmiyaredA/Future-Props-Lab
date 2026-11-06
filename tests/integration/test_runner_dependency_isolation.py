"""Independent runner instances must never borrow another application's database."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

from studio.apps.agent_workbench.execution import runner


async def test_workbench_queue_reads_use_the_factory_of_the_owning_runner(monkeypatch):
    reads = []
    closed = []

    def sessions_for(database):
        @asynccontextmanager
        async def sessions():
            try:
                yield SimpleNamespace(database=database)
            finally:
                closed.append(database)

        return sessions

    async def next_queued(session, owner, chat):
        reads.append((session.database, owner, chat))
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(runner.transcripts, "next_queued", next_queued)
    settings = SimpleNamespace()
    first = runner.WorkbenchRuns(sessions_for("first"), settings, load_settings=lambda: settings)
    second = runner.WorkbenchRuns(sessions_for("second"), settings, load_settings=lambda: settings)
    await asyncio.gather(first.advance("alice", "one"), second.advance("bob", "two"))
    assert sorted(reads) == [("first", "alice", "one"), ("second", "bob", "two")]
    assert sorted(closed) == ["first", "second"]
    await first.close()
    await first.advance("alice", "three")
    await second.advance("bob", "four")
    assert reads[-1] == ("second", "bob", "four")
    assert len(reads) == 3
    await second.close()
