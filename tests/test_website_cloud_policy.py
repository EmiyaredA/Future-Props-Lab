"""Website policy isolation and ongoing desktop authorization checks."""

import asyncio
from contextlib import AsyncExitStack, aclosing

import pytest
from sqlalchemy import select

from db.migrations import runner as migration_runner
from studio.apps.identity.storage.models.accounts import AuthSession
from studio.apps.remote_desktop.transport import guacamole as desktop
from studio.assembly.website.application import create_app
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from test_cloud_control import CLOUD, admin_client, configure, unlock
from website_test_support import app

pytestmark = pytest.mark.real_auth


async def test_website_cloud_policy_is_isolated_and_revoked_during_desktop_watch(tmp_path):
    first_settings, second_settings = (
        app.state.settings.model_copy(
            update={
                "fpl_database_path": str(tmp_path / label / "website.db"),
                "fpl_cloud_control_enabled": False,
                "fpl_cloud_control_host_label": label,
            }
        )
        for label in ("first", "second")
    )
    for settings in (first_settings, second_settings):
        migration_runner.apply_migrations(settings.database_path)

    first_policy = first_settings.model_copy(update={"fpl_cloud_control_enabled": True})
    reads = 0

    def read_first_policy():
        nonlocal reads
        reads += 1
        return first_policy

    async with AsyncExitStack() as stack:
        first = create_app(first_settings, read_cloud_settings=read_first_policy)
        second = create_app(second_settings)
        for website in (first, second):
            stack.push_async_callback(website.state.database.engine.dispose)
        first_client, first_owner = await admin_client(website=first)
        stack.push_async_callback(first_client.aclose)
        second_client, second_owner = await admin_client(website=second)
        stack.push_async_callback(second_client.aclose)
        first_policy.fpl_cloud_control_admin_user_ids = first_owner
        second_settings.fpl_cloud_control_admin_user_ids = second_owner
        second_settings.fpl_cloud_control_enabled = True

        await unlock(first_client)
        await unlock(second_client)
        before = reads
        first_status = (await first_client.get(CLOUD + "/status")).json()
        assert reads == before + 1
        assert first_status["host_label"] == "first"
        assert first_status["enabled"] and first_status["desktop_authorized"]
        assert first_status["unlocked_until"] > 0

        async with first.state.database.sessions() as db:
            session_id = await db.scalar(
                select(AuthSession.id).where(AuthSession.user_id == first_owner)
            )
        principal = StudioPrincipal(
            user_id=first_owner,
            must_change_password=False,
            auth_kind="session",
            scopes=role_scopes("admin"),
            platform_role="admin",
            session_id=session_id,
        )
        polled = asyncio.Event()
        changed = asyncio.Event()

        async def check():
            minutes = await first.state.cloud_desktop.access(principal, True)
            polled.set()
            return minutes

        watcher = asyncio.create_task(
            desktop.watch_access(
                desktop.DesktopInput(asyncio.get_running_loop().time), changed, check
            )
        )
        try:
            await asyncio.wait_for(polled.wait(), 3)
            assert not watcher.done()
            first_policy = first_policy.model_copy(update={"fpl_cloud_control_enabled": False})
            changed.set()
            assert await asyncio.wait_for(watcher, 3) == "desktop_authorization_required"
        finally:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

        revoked = (await first_client.get(CLOUD + "/status")).json()
        assert not revoked["enabled"] and not revoked["desktop_authorized"]
        assert revoked["unlocked_until"] == 0
        second_status = (await second_client.get(CLOUD + "/status")).json()
        assert second_status["host_label"] == "second"
        assert second_status["enabled"] and second_status["desktop_authorized"]
        assert second_status["unlocked_until"] > 0


async def test_desktop_password_is_redacted_and_connection_attempts_are_limited(monkeypatch):
    client, owner = await admin_client()
    configure(monkeypatch, owner)
    async with aclosing(client):
        oversized = "secret-not-for-response-" * 12
        result = await client.post(CLOUD + "/desktop/connect", json={"password": oversized})
        assert result.status_code == 422
        assert oversized not in result.text
        for _ in range(8):
            result = await client.post(CLOUD + "/desktop/connect", json={"password": "test"})
            assert result.status_code == 204
        assert (
            await client.post(CLOUD + "/desktop/connect", json={"password": "test"})
        ).status_code == 429
