import asyncio
from contextlib import aclosing
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from cryptography.fernet import Fernet

from studio.apps.remote_desktop.transport.app_signaling import bridge
from studio.apps.remote_desktop.use_cases.app_sessions import AppSessions, turn_servers
from studio.assembly.website import remote_apps
from studio.contracts.remote_desktop.apps import RemoteApp
from tests.apps.remote_desktop.test_cloud_control import (
    CLOUD,
    PASSWORD,
    admin_client,
    configure,
    unlock,
)
from website_test_support import app

APP = RemoteApp(id="a" * 64, name="文本编辑", recommended=True)
OTHER = RemoteApp(id="b" * 64, name="Installed only")
APPS = CLOUD + "/apps"


def test_tickets_are_single_use_and_bound_to_the_browser_session():
    now = 0
    service = AppSessions(clock=lambda: now)
    owner = SimpleNamespace(user_id="a", session_id="1")
    different_session = SimpleNamespace(user_id="a", session_id="2")
    ticket = service.issue(owner, True, APP.id)
    assert service.take(ticket, different_session, True) is None
    assert service.take(ticket, owner, False) is None
    assert service.take(ticket, owner, True).app == APP.id
    assert service.take(ticket, owner, True) is None
    ticket = service.issue(owner, True, APP.id)
    now += 30
    assert service.take(ticket, owner, True) is None


def test_ice_configuration_uses_own_stun_and_expiring_turn_credentials():
    urls = "turn:turn.example.test:3478?transport=udp,turns:turn.example.test:5349"
    stun, turn = turn_servers(urls, "fixture", now=123)
    assert stun.urls == ["stun:turn.example.test:3478"]
    assert turn.urls == urls.split(",")
    assert turn.username.startswith("3723:")
    assert turn.credential and "fixture" not in turn.model_dump_json()
    assert not turn_servers(urls, "")


async def test_signaling_stops_when_the_app_authorization_is_revoked():
    blocked = asyncio.Event()
    socket = SimpleNamespace(receive=blocked.wait, close=AsyncMock())
    process = SimpleNamespace(
        stdin=SimpleNamespace(write=Mock(), drain=AsyncMock()),
        stdout=asyncio.StreamReader(),
    )
    await asyncio.wait_for(
        bridge(socket, process, access=AsyncMock(return_value=None), ice_servers=[]), 1
    )
    socket.close.assert_awaited_once_with(4403, "应用授权已失效")


@pytest.mark.real_auth
async def test_catalog_only_exposes_approved_apps_to_verified_public_browser(monkeypatch):
    client, owner = await admin_client(local=False)
    configure(monkeypatch, owner)
    settings = app.state.read_cloud_settings()
    monkeypatch.setattr(settings, "fpl_cloud_control_apps_enabled", True)
    monkeypatch.setattr(settings, "fpl_cloud_control_apps_allowed", APP.id)
    monkeypatch.setattr(app.state, "read_cloud_settings", lambda: settings)

    async def catalog(_):
        return [APP, OTHER]

    monkeypatch.setattr(remote_apps, "catalog", catalog)
    async with aclosing(client):
        assert (await client.get(APPS)).status_code == 403
        assert (await client.get(APPS + "/installed")).status_code == 403
        assert (await client.post(APPS + "/connect", json={"app_id": APP.id})).status_code == 403
        await unlock(client, "desktop")
        listed = await client.get(APPS)
        assert listed.status_code == 200
        assert listed.headers["cache-control"] == "no-store"
        assert listed.json() == {"apps": [APP.model_dump()]}
        assert (await client.post(APPS + "/connect", json={"app_id": OTHER.id})).status_code == 404
        assert (await client.post(APPS + "/connect", json={"app_id": APP.id})).json()["ticket"]
        assert (
            await client.put(APPS, json={"revision": "a" * 64, "app_ids": [OTHER.id]})
        ).status_code == 403


@pytest.mark.real_auth
async def test_local_catalog_mutation_requires_password_and_current_revision(monkeypatch, tmp_path):
    client, owner = await admin_client()
    configure(monkeypatch, owner)
    settings = app.state.read_cloud_settings()
    monkeypatch.setattr(settings, "fpl_cloud_control_apps_enabled", True)
    path = tmp_path / "config.toml"
    key = Fernet.generate_key().decode()
    path.write_text(
        f'[cloud_control]\napps_enabled = true\n[security]\nsecrets_key = "{key}"\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(remote_apps, "CONFIG_FILE", path)

    def settings_snapshot():
        fields = remote_apps.config_bytes(path)
        allowed = APP.id if APP.id.encode() in fields else ""
        return settings.model_copy(update={"fpl_cloud_control_apps_allowed": allowed})

    async def catalog(_):
        return [APP, OTHER]

    monkeypatch.setattr(app.state, "read_cloud_settings", settings_snapshot)
    monkeypatch.setattr(remote_apps, "catalog", catalog)
    async with aclosing(client):
        installed = (await client.get(APPS + "/installed")).json()
        assert installed["apps"] == [APP.model_dump(), OTHER.model_dump()]
        assert not installed["allowed_ids"]
        body = {"revision": installed["revision"], "app_ids": [APP.id]}
        assert (await client.put(APPS, json=body)).status_code == 403
        assert (
            await client.post("/v1/auth/reauth", json={"password": PASSWORD})
        ).status_code == 204
        assert (await client.put(APPS, json={**body, "app_ids": [APP.id] * 2})).status_code == 422
        saved = await client.put(APPS, json=body)
        assert saved.status_code == 200, saved.text
        assert saved.json()["allowed_ids"] == [APP.id]
        assert (await client.put(APPS, json=body)).status_code == 409
