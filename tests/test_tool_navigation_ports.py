"""The same navigation contract runs against memory and both SQLite assemblies."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.tools.storage.navigation import NavigationRecords
from studio.apps.tools.storage.navigation_models import ToolNavigationItem
from studio.apps.tools.use_cases.navigation import ToolNavigation
from studio.assembly.website.models import WebsiteSession
from studio.contracts.tools.navigation import ToolNavigationItemOut, ToolNavigationStateOut
from studio.runtime.database.sessions import Database
from studio.runtime.database.website import WebsiteDatabase
from studio.runtime.time import iso_utc

NOW = datetime(2026, 11, 5, 12)


class MemoryNavigation:
    def __init__(self):
        self.items = {}
        self.lock = asyncio.Lock()

    async def list(self, *, owner):
        items = [
            v.model_copy(deep=True) for (account, _), v in self.items.items() if account == owner
        ]
        items.sort(key=lambda item: item.tool_id)
        items.sort(key=lambda item: item.favorite_updated_at or "", reverse=True)
        items.sort(key=lambda item: item.last_used_at or "", reverse=True)
        return ToolNavigationStateOut(items=items)

    def _item(self, owner, tool_id):
        return self.items.setdefault(
            (owner, tool_id),
            ToolNavigationItemOut(
                tool_id=tool_id,
                is_favorite=False,
                favorite_updated_at=None,
                last_used_at=None,
                use_count=0,
            ),
        )

    async def set_favorite(self, *, owner, tool_id, is_favorite, at):
        async with self.lock:
            item = self._item(owner, tool_id)
            item.is_favorite = is_favorite
            item.favorite_updated_at = iso_utc(at) if is_favorite else None
            return item.model_copy(deep=True)

    async def record_use(self, *, owner, tool_id, at):
        async with self.lock:
            item = self._item(owner, tool_id)
            item.use_count += 1
            item.last_used_at = iso_utc(at)
            return item.model_copy(deep=True)


@asynccontextmanager
async def sql_store(kind, root):
    database = (
        Database("tools", root, models=(ToolNavigationItem,))
        if kind == "independent"
        else WebsiteDatabase(
            f"sqlite+aiosqlite:///{root / 'website.db'}", session_class=WebsiteSession
        )
    )
    async with database.engine.begin() as connection:
        await connection.run_sync(ToolNavigationItem.__table__.create)
    try:
        yield NavigationRecords(database.sessions)
    finally:
        await database.close()


@pytest.fixture(params=["memory", "website", "independent"])
async def store(request, tmp_path):
    if request.param == "memory":
        yield MemoryNavigation()
    else:
        async with sql_store(request.param, tmp_path) as records:
            yield records


async def test_navigation_contract(store):
    navigation = ToolNavigation(store, clock=lambda: NOW)
    assert not (await navigation.list(owner="alice")).items
    initial = await navigation.set_favorite(owner="alice", tool_id="editor", is_favorite=True)
    calls = await asyncio.gather(
        *(navigation.record_use(owner="alice", tool_id="editor") for _ in range(8)),
        navigation.set_favorite(owner="alice", tool_id="editor", is_favorite=False),
    )
    assert sorted(item.use_count for item in calls[:8]) == list(range(1, 9))
    current = (await navigation.list(owner="alice")).items[0]
    assert current.use_count == 8 and not current.is_favorite
    assert current.favorite_updated_at is None and current.last_used_at == iso_utc(NOW)
    assert initial.is_favorite and initial.use_count == 0
    assert not (await navigation.list(owner="bob")).items
    await navigation.record_use(owner="bob", tool_id="editor")
    assert (await navigation.list(owner="alice")).items[0].use_count == 8
    current.use_count = 999
    assert (await navigation.list(owner="alice")).items[0].use_count == 8
    for owner, tool in [("", "editor"), ("alice", "Bad_ID")]:
        with pytest.raises(ValueError):
            await navigation.record_use(owner=owner, tool_id=tool)


@pytest.mark.parametrize("kind", ["website", "independent"])
@pytest.mark.parametrize("failure", ["before_commit", "cancel", "lost_ack"])
async def test_navigation_rollback_and_unknown_result(kind, failure, tmp_path, monkeypatch):
    async with sql_store(kind, tmp_path) as records:
        navigation = ToolNavigation(records, clock=lambda: NOW)
        original = AsyncSession.commit

        async def fail(session):
            if failure == "lost_ack":
                await original(session)
            else:
                await session.flush()
            if failure == "cancel":
                raise asyncio.CancelledError()
            raise RuntimeError(failure)

        with monkeypatch.context() as patch:
            patch.setattr(AsyncSession, "commit", fail)
            with pytest.raises(asyncio.CancelledError if failure == "cancel" else RuntimeError):
                await navigation.record_use(owner="alice", tool_id="editor")
        state = await navigation.list(owner="alice")
        if failure == "lost_ack":
            assert state.items[0].use_count == 1
        else:
            assert not state.items
            assert (await navigation.record_use(owner="alice", tool_id="editor")).use_count == 1
