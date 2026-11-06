"""Remote receives a scoped desktop proof without the browser's credential."""

import json
from pathlib import Path

import httpx
import pytest

from studio.apps.gateway.storage.migrations.registry import MIGRATIONS as GATEWAY_MIGRATIONS
from studio.apps.gateway.transport.cloud_control import LocalHappier
from studio.apps.identity.accounts import create_account
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.assembly.independent.gateway.application import create_app as create_gateway
from studio.config.settings import get_settings
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.contracts.identity.cloud_authority import (
    AUTHORITY_PATH,
    DESKTOP_COOKIE,
    DESKTOP_SOCKET,
    desktop_ticket_digest,
)
from studio.contracts.identity.happier import BROWSER_COOKIE, EXCHANGE_PATH, LAUNCH_PATH
from studio.deployment.gateway import render_gateway
from studio.runtime.database.migrations import apply
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    GATEWAY_SECRET,
    PASSWORD,
    Noop,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[3]
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


async def test_local_happier_grant_is_revoked_by_identity(scenario, monkeypatch, tmp_path):  # noqa: F811
    studio = "https://studio.fpl.localhost:3443"
    origin = "https://happier.fpl.localhost:3444"
    public = "https://studio.example.test"
    credential = "gateway-happier-authority-fixture-00000"
    identity = scenario.identity
    async with identity.state.database.sessions() as session:
        admin, _ = await create_account(
            session,
            username="happier-admin",
            display_name="Happier Admin",
            password=PASSWORD,
            platform_role="admin",
        )
    config = identity.state.settings.model_copy(
        update={
            "fpl_cloud_control_enabled": True,
            "fpl_cloud_control_admin_user_ids": admin.id,
            "fpl_happier_admin_user_id": admin.id,
            "fpl_happier_studio_origin": studio,
            "fpl_happier_origin": origin,
        }
    )
    monkeypatch.setattr(identity.state, "settings", config)
    monkeypatch.setattr(identity.state, "read_cloud_settings", lambda: config)
    monkeypatch.setattr(identity.state.cloud_unlocks, "settings_reader", lambda: config)
    identity.state.identity_options["service_credentials"]["gateway"] = credential
    live = LiveAuthorization(service="gateway", credential=credential, transport=scenario.mesh)
    happier = LocalHappier(studio_origin=studio, origin=origin, relay_port=3305, identity=live)

    class RelayBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"Relay HTML"

    async def relay(request):
        assert BROWSER_COOKIE not in request.headers.get("cookie", "")
        if request.url.path == "/v1/features":
            return httpx.Response(
                200, json={"capabilities": {"encryption": {"storagePolicy": "required_e2ee"}}}
            )
        return httpx.Response(200, stream=RelayBody(), headers={"Content-Type": "text/html"})

    await happier.ingress.client.aclose()
    happier.ingress.client = httpx.AsyncClient(transport=httpx.MockTransport(relay))
    state = tmp_path / "gateway"
    apply(state / "service.db", "gateway", GATEWAY_MIGRATIONS)
    monkeypatch.setenv("FPL_DATABASE_PATH", str(state / "service.db"))
    get_settings.cache_clear()
    gateway = create_gateway(
        state_root=state,
        catalog=CATALOG,
        public_key=scenario.key.public_key(),
        capabilities=Noop(),
        happier=happier,
        schema=json.loads((ROOT / "web/src/generated/openapi.json").read_text()),
        manifest={},
    )
    ingress_headers = {
        "X-Fpl-Gateway": GATEWAY_SECRET,
        "X-Fpl-Ingress": "local",
        "X-Fpl-Client-Ip": "127.0.0.1",
    }
    async with (
        gateway.router.lifespan_context(gateway),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(identity), base_url=ORIGIN, headers=ingress_headers
        ) as admin_browser,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(gateway), base_url=studio
        ) as studio_browser,
        httpx.AsyncClient(transport=httpx.ASGITransport(gateway), base_url=origin) as relay_browser,
    ):
        login = await admin_browser.post(
            "/v1/auth/login", json={"username": "happier-admin", "password": PASSWORD}
        )
        assert login.status_code == 200, login.text
        csrf = {"Origin": ORIGIN, "X-CSRF-Token": admin_browser.cookies["fpl_csrf"]}

        async def assertion():
            result = await admin_browser.get(
                "/_internal/v1/authorize",
                headers={
                    **csrf,
                    "X-Fpl-Target-Service": "gateway",
                    "X-Fpl-Request-Method": "POST",
                    "X-Fpl-Request-Uri": LAUNCH_PATH,
                },
            )
            assert result.status_code == 204, result.text
            return {HEADER: result.headers[HEADER], "Origin": studio}

        assert (await relay_browser.get("/")).status_code == 403
        headers = await assertion()
        assert (await studio_browser.post(LAUNCH_PATH, headers=headers)).status_code == 403
        assert (
            await admin_browser.post("/v1/auth/reauth", headers=csrf, json={"password": PASSWORD})
        ).status_code == 204
        assert (
            await admin_browser.post(
                "/v1/cloud-control/unlock", headers=csrf, json={"purpose": "agent"}
            )
        ).status_code == 204
        headers = await assertion()
        assert (
            await studio_browser.post(LAUNCH_PATH, headers={**headers, "Origin": public})
        ).status_code == 403
        launched = await studio_browser.post(LAUNCH_PATH, headers=headers)
        assert launched.status_code == 200, launched.text
        ticket = {"ticket": launched.json()["ticket"]}
        exchange = await relay_browser.post(EXCHANGE_PATH, data=ticket, headers={"Origin": studio})
        assert exchange.status_code == 204, exchange.text
        assert BROWSER_COOKIE in relay_browser.cookies
        assert (await relay_browser.get("/")).text == "Relay HTML"
        assert (
            await relay_browser.post(EXCHANGE_PATH, data=ticket, headers={"Origin": studio})
        ).status_code == 403
        assert (await admin_browser.post("/v1/auth/logout", headers=csrf)).status_code == 204
        assert (await relay_browser.get("/")).status_code == 403
