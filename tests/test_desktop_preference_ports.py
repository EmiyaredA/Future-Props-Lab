"""Idle policy CAS and failure semantics shared by memory and both SQLite layouts."""

import asyncio
from dataclasses import FrozenInstanceError
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.identity.storage.models.accounts import User
from studio.apps.remote_desktop.storage.migrations.registry import MIGRATIONS
from studio.apps.remote_desktop.storage.preference_models import DesktopPreference
from studio.apps.remote_desktop.storage.preferences import PreferenceRecords
from studio.apps.remote_desktop.use_cases.preferences import (
    DesktopPreferences,
    IdleSnapshot,
    PreferenceConflict,
)
from studio.assembly.website.models import WebsiteSession
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.database.website import WebsiteDatabase


class MemoryPreferences:
    def __init__(self):
        self.records = {}
        self.lock = asyncio.Lock()

    async def read(self, *, owner):
        return self.records.get(owner, IdleSnapshot())

    async def compare_and_set(self, *, owner, minutes, expected_revision):
        async with self.lock:
            current = await self.read(owner=owner)
            if current.revision != expected_revision:
                raise PreferenceConflict(current)
            updated = IdleSnapshot(minutes, current.revision + 1)
            self.records[owner] = updated
            return updated


@pytest.fixture(params=["memory", "website", "independent"])
async def case(request, tmp_path):
    database = None
    if request.param == "memory":
        store = MemoryPreferences()
    elif request.param == "independent":
        database = Database("remote", tmp_path, models=(DesktopPreference,))
        apply(database.path, "remote", MIGRATIONS)
        store = PreferenceRecords(database.sessions)
    else:
        database = WebsiteDatabase(
            f"sqlite+aiosqlite:///{tmp_path / 'website.db'}", session_class=WebsiteSession
        )
        async with database.engine.begin() as connection:
            await connection.run_sync(User.__table__.create)
            await connection.run_sync(DesktopPreference.__table__.create)
        async with database.sessions() as db:
            for owner in ("alice", "bob"):
                db.add(
                    User(id=owner, username=owner, username_normalized=owner, password_hash="test")
                )
            await db.commit()
        store = PreferenceRecords(database.sessions)
    try:
        yield SimpleNamespace(store=store, preferences=DesktopPreferences(store), database=database)
    finally:
        if database:
            await database.close()


async def test_preference_contract_concurrent_cas_and_owner_isolation(case):
    prefs = case.preferences
    assert await prefs.read(owner="alice") == IdleSnapshot()
    results = await asyncio.gather(
        prefs.save(owner="alice", minutes=10, revision=0),
        prefs.save(owner="alice", minutes=15, revision=0),
        return_exceptions=True,
    )
    current = await prefs.read(owner="alice")
    assert current.revision == 1
    assert sum(isinstance(value, IdleSnapshot) for value in results) == 1
    conflict = next(value for value in results if isinstance(value, PreferenceConflict))
    assert conflict.current == current
    assert await prefs.read(owner="bob") == IdleSnapshot()
    await prefs.save(owner="bob", minutes=60, revision=0)
    assert await prefs.read(owner="alice") == current
    with pytest.raises(FrozenInstanceError):
        current.idle_minutes = 120
    for minutes, revision in ((True, 1), (4, 1), (121, 1), (30, -1)):
        with pytest.raises(ValueError):
            await prefs.save(owner="alice", minutes=minutes, revision=revision)
    assert await prefs.read(owner="alice") == current


@pytest.mark.parametrize("failure", ["cancel", "rollback", "lost-ack"])
async def test_preference_contract_failed_and_unknown_commit(case, monkeypatch, failure):
    initial = await case.preferences.save(owner="alice", minutes=15, revision=0)
    commit = AsyncSession.commit

    async def interrupted(db):
        if failure == "lost-ack":
            await commit(db)
        else:
            await db.flush()
        if failure == "cancel":
            raise asyncio.CancelledError
        raise OSError("isolated commit failure")

    update = case.store.compare_and_set

    async def interrupted_memory(**kwargs):
        if failure == "lost-ack":
            await update(**kwargs)
        if failure == "cancel":
            raise asyncio.CancelledError
        raise OSError("isolated commit failure")

    with monkeypatch.context() as scope:
        if case.database:
            scope.setattr(AsyncSession, "commit", interrupted)
        else:
            scope.setattr(case.store, "compare_and_set", interrupted_memory)
        with pytest.raises((asyncio.CancelledError, OSError)):
            await case.preferences.save(owner="alice", minutes=20, revision=1)
    # A fresh storage adapter reconstructs the committed snapshot after restart.
    if case.database:
        case.preferences = DesktopPreferences(PreferenceRecords(case.database.sessions))
    expected = IdleSnapshot(20, 2) if failure == "lost-ack" else initial
    assert await case.preferences.read(owner="alice") == expected
