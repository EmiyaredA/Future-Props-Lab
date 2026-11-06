"""Remote receives a scoped desktop proof without the browser's credential."""

from pathlib import Path

import httpx
import pytest
from tests.test_community_asset_protocol import PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from studio.apps.identity.accounts import create_account
from studio.config.settings import get_settings
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.contracts.identity.cloud_authority import (
    AUTHORITY_PATH,
    DESKTOP_COOKIE,
    DESKTOP_SOCKET,
    desktop_ticket_digest,
)
from studio.deployment.gateway import render_gateway

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:19000"
REMOTE_CREDENTIAL = "remote-cloud-authority-credential-fixture"


async def test_only_remote_websocket_receives_desktop_ticket_proof(scenario, monkeypatch):  # noqa: F811
    case = scenario
    async with case.identity.state.database.sessions() as session:
        admin, _ = await create_account(
            session,
            username="desktop-admin",
            display_name="Desktop Admin",
            password=PASSWORD,
            platform_role="admin",
        )
    login = await case.browser.post(
        "/v1/auth/login", json={"username": "desktop-admin", "password": PASSWORD}
    )
    assert login.status_code == 200
    case.csrf = case.browser.cookies["fpl_csrf"]
    settings = get_settings().model_copy(
        update={
            "fpl_cloud_control_enabled": True,
            "fpl_cloud_control_admin_user_ids": admin.id,
        }
    )
    reads = 0

    def read_policy():
        nonlocal reads
        reads += 1
        return settings

    monkeypatch.setattr(case.identity.state, "read_cloud_settings", read_policy)
    case.identity.state.identity_options["service_credentials"]["remote"] = REMOTE_CREDENTIAL

    headers = {
        "X-Fpl-Target-Service": "remote",
        "X-Fpl-Request-Method": "GET",
        "X-Fpl-Request-Uri": DESKTOP_SOCKET,
        "X-Fpl-Request-Protocol": "websocket",
    }
    rejected = await case.browser.get("/_internal/v1/authorize", headers=headers)
    assert rejected.status_code == 403
    raw_ticket = "D" * 43
    case.browser.cookies.set(DESKTOP_COOKIE, raw_ticket)
    result = await case.browser.get("/_internal/v1/authorize", headers=headers)
    assert result.status_code == 204
    token = result.headers[HEADER]
    actor = verify_context(
        token,
        service="remote",
        method="GET",
        path=DESKTOP_SOCKET,
        public_key=case.key.public_key(),
    )
    assert actor.user_id == admin.id and actor.local
    assert actor.desktop_ticket_sha256 == desktop_ticket_digest(raw_ticket)
    with pytest.raises(ValueError, match="必须绑定"):
        issue_context(
            actor,
            service="models",
            method="GET",
            path="/v1/model-test/realtime",
            private_key=case.key,
            key_id="isolated",
        )

    status_path = "/v1/cloud-control/status"
    status_headers = await authorize(case, "remote", "GET", status_path)
    status_actor = verify_context(
        status_headers[HEADER],
        service="remote",
        method="GET",
        path=status_path,
        public_key=case.key.public_key(),
    )
    assert status_actor.desktop_ticket_sha256 is None

    body = {"service": "remote", "method": "GET", "path": DESKTOP_SOCKET, "assertion": token}
    async with httpx.AsyncClient(
        base_url="http://identity",
        transport=case.mesh,
        headers={"Authorization": f"Bearer {REMOTE_CREDENTIAL}"},
    ) as service:
        before = reads
        authority = await service.post(AUTHORITY_PATH, json=body)
        assert reads == before + 1
        assert authority.status_code == 200
        assert authority.json()["active"] and authority.json()["desktop_authorized"]
        assert raw_ticket not in authority.text
        with monkeypatch.context() as revoked_policy:
            revoked_policy.setattr(settings, "fpl_cloud_control_enabled", False)
            revoked = await service.post(AUTHORITY_PATH, json=body)
            assert revoked.status_code == 200
            assert revoked.json()["active"]
            assert not revoked.json()["enabled"]
            assert not revoked.json()["desktop_authorized"]
            assert revoked.json()["unlocked_until"] == 0
            assert (
                await case.browser.get("/_internal/v1/authorize", headers=headers)
            ).status_code == 403
        foreign = await service.post(
            AUTHORITY_PATH, json={**body, "path": "/v1/model-test/realtime"}
        )
        assert foreign.status_code == 403
        browser = await service.post(AUTHORITY_PATH, headers={"Origin": ORIGIN}, json=body)
        assert browser.status_code == 403
        logout = await case.browser.post(
            "/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": case.csrf}
        )
        assert logout.status_code == 204
        inactive = await service.post(AUTHORITY_PATH, json=body)
        assert inactive.status_code == 200
        assert inactive.json()["active"] is False


def test_gateway_strips_browser_cookie_before_the_remote_upgrade():
    rendered = render_gateway(
        RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
        gateway_token="x" * 48,
        local_origin=ORIGIN,
        public_origin="https://studio.example.test",
    )
    assert "copy_headers X-Fpl-Context" in rendered
    assert (
        rendered.count(
            "reverse_proxy remote:8080 {\n          flush_interval -1\n          header_up -Cookie"
        )
        >= 2
    )
