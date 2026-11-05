"""Compatibility settings keep partition, revision and enclosing transaction semantics."""

import asyncio

import pytest
from sqlalchemy import text

from studio.apps.model_service.storage.website_settings import model_settings
from studio.assembly.website.models import WebsiteSession
from studio.contracts.management.setting_owners import setting_owner
from studio.runtime.database.settings_models import PlatformSetting
from studio.runtime.database.settings_records import SettingConflict, SettingsPartition
from studio.runtime.database.website import WebsiteDatabase


@pytest.fixture
async def database(tmp_path):
    handle = WebsiteDatabase(
        f"sqlite+aiosqlite:///{tmp_path / 'settings.db'}", session_class=WebsiteSession
    )
    async with handle.engine.begin() as connection:
        await connection.run_sync(PlatformSetting.__table__.create)
    try:
        yield handle
    finally:
        await handle.close()


async def test_registered_partitions_and_detached_values(database):
    async with database.sessions() as session:
        models = model_settings(session)
        for key in ("code_agents", "unknown", "role_template:"):
            with pytest.raises(ValueError):
                await models.read(key, {})
            with pytest.raises(ValueError):
                await models.replace(key, {}, expected_revision=0)
        defaults = {"nested": {"value": "original"}}
        absent = await models.read("runtime_quotas", defaults)
        absent["value"]["nested"]["value"] = "local edit"
        assert defaults["nested"]["value"] == "original"
        await session.execute(text("BEGIN IMMEDIATE"))
        saved = await models.replace("runtime_quotas", defaults, expected_revision=0)
        saved["value"]["nested"]["value"] = "local edit"
        await session.commit()
    async with database.sessions() as session:
        models = model_settings(session)
        state = await models.read("runtime_quotas", {})
        assert state == {"revision": 1, "value": defaults}
        state["value"]["nested"]["value"] = "another edit"
        assert (await models.read("runtime_quotas", {}))["value"] == defaults
        agent = SettingsPartition(
            session, accepts=lambda key: setting_owner(key) == "agent-runtime"
        )
        with pytest.raises(ValueError):
            await agent.read("runtime_quotas", {})
        assert (await agent.read("code_agents", {}))["revision"] == 0


async def test_parallel_cas_commits_exactly_one_change(database):
    async def write(value):
        async with database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            records = model_settings(session)
            try:
                saved = await records.replace(
                    "runtime_quotas", {"value": value}, expected_revision=0
                )
                await session.commit()
                return saved
            except SettingConflict as error:
                return error

    results = await asyncio.gather(write("first"), write("second"))
    saved = [r for r in results if isinstance(r, dict)]
    failed = [r for r in results if isinstance(r, SettingConflict)]
    assert len(saved) == len(failed) == 1
    assert failed[0].current == saved[0]


@pytest.mark.parametrize("cancel", [False, True])
async def test_settings_share_caller_rollback(database, cancel):
    failure = asyncio.CancelledError if cancel else RuntimeError
    with pytest.raises(failure):
        async with database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            records = model_settings(session)
            await records.replace("runtime_quotas", {"a": 1}, expected_revision=0)
            await records.replace("role_template:user", {"b": 2}, expected_revision=0)
            raise failure()
    async with database.sessions() as session:
        for key in ("runtime_quotas", "role_template:user"):
            assert (await model_settings(session).read(key, {}))["revision"] == 0
