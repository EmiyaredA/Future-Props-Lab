"""Exercise trusted-local settings through the independently leased Mac coordinator."""

import asyncio
from dataclasses import replace

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import select
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from studio.apps.identity.accounts import create_account
from studio.apps.remote_desktop.settings import RemoteSettings
from studio.apps.remote_desktop.storage.migrations.registry import MIGRATIONS
from studio.apps.remote_desktop.storage.service_models import RemoteSetupJob
from studio.assembly.independent.remote_desktop.application import create_app
from studio.config.cloud_projection import CloudProjection
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.contracts.remote_desktop.setup import SETTINGS_PATH
from studio.host.deployment.cloud_setup_worker import CloudSetupWorker
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions

CREDENTIAL = "isolated-remote-service-credential-" * 2
INGRESS = "isolated-remote-ingress-credential-" * 2
TOKEN = "isolated-remote-mac-credential-" * 2
ORIGIN = "http://127.0.0.1:19000"


class Bridge(httpx.AsyncBaseTransport):
    def __init__(self, app):
        self.upstream = httpx.ASGITransport(app=app)
        self.lose_receipt = False
        self.on_authorize = None

    async def handle_async_request(self, request):
        request.url = request.url.copy_with(path=request.url.path.removeprefix("/remote"))
        request.headers["X-Fpl-Native-Ingress"] = INGRESS
        if self.on_authorize and request.url.path.endswith("/authorize"):
            await self.on_authorize()
        response = await self.upstream.handle_async_request(request)
        if self.lose_receipt and request.url.path.endswith("/receipt"):
            self.lose_receipt = False
            assert response.status_code == 200
            await response.aclose()
            return httpx.Response(503)
        return response


async def test_remote_settings_commit_live_scopes_and_replay_receipt(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    async with case.identity.state.database.sessions() as db:
        account, _ = await create_account(
            db,
            username="setup-admin",
            display_name="Setup Admin",
            password=PASSWORD,
            platform_role="admin",
        )
        owner = account.id
    case.identity.state.identity_options["service_credentials"]["remote"] = CREDENTIAL
    login = await case.browser.post(
        "/v1/auth/login", json={"username": "setup-admin", "password": PASSWORD}
    )
    assert login.status_code == 200
    case.csrf = case.browser.cookies["fpl_csrf"]

    host = tmp_path / "host"
    host.mkdir(mode=0o700)
    config = host / "config.toml"
    config.write_text(
        "[cloud_control]\nhost_label = 'Before'\n[security]\n"
        f"secrets_key = '{Fernet.generate_key().decode()}'\n"
    )
    projections = host / "projections"
    projections.mkdir(mode=0o700)
    projection = CloudProjection("remote", projections / "remote", projections / "committed")
    monkeypatch.setenv("FPL_IDENTITY_CLOUD_PROJECTION_DIR", str(projections / "identity"))
    monkeypatch.setenv("FPL_CLOUD_SETTINGS_COMMIT_DIR", str(projections / "committed"))

    root = tmp_path / "remote"
    apply(root / "service.db", "remote", MIGRATIONS)
    guacd = await asyncio.start_server(lambda _reader, writer: writer.close(), "127.0.0.1", 0)
    app = create_app(
        state_root=root,
        settings=RemoteSettings(
            ORIGIN,
            guacd_host="127.0.0.1",
            fpl_cloud_control_guacd_port=guacd.sockets[0].getsockname()[1],
        ),
        public_key=case.key.public_key(),
        credential=CREDENTIAL,
        catalog=CATALOG,
        transport=case.mesh,
        setup_options=NativeWorkerOptions(
            identity_credential=CREDENTIAL, ingress=INGRESS, workers={"mac": TOKEN}
        ),
        cloud_projection=projection,
    )
    bridge = Bridge(app)
    transport = NativeTransport(
        service="remote", base_url=ORIGIN + "/remote", credential=TOKEN, transport=bridge
    )
    worker = CloudSetupWorker(transport, config, projections, host)
    async with (
        guacd,
        app.router.lifespan_context(app),
        transport.client,
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as api,
        asyncio.timeout(20),
    ):
        assert (await api.get("/ready")).status_code == 503
        await worker.poll_once()
        assert (await api.get("/ready")).status_code == 200
        read_headers = await authorize(case, "remote", "GET", SETTINGS_PATH)
        original = verify_context(
            read_headers[HEADER],
            service="remote",
            method="GET",
            path=SETTINGS_PATH,
            public_key=case.key.public_key(),
        )
        remote_assertion = issue_context(
            replace(original, local=False),
            service="remote",
            method="GET",
            path=SETTINGS_PATH,
            private_key=case.key,
            key_id="fixture",
        )
        public = await api.get(SETTINGS_PATH, headers={HEADER: remote_assertion})
        assert public.status_code == 403 and "Before" not in public.text

        async def submit(method, **kwargs):
            headers = await authorize(case, "remote", method, SETTINGS_PATH)
            pending = asyncio.create_task(
                api.request(method, SETTINGS_PATH, headers=headers, **kwargs)
            )
            for _ in range(3):
                if pending.done():
                    break
                try:
                    await worker.poll_once()
                except httpx.HTTPStatusError as exc:
                    assert exc.response.status_code == 503
            return await pending

        read = await submit("GET")
        assert read.status_code == 200 and read.json()["host_label"] == "Before", read.text
        assert read.json()["guacd_ready"]
        body = {"revision": read.json()["revision"], "host_label": "After", "public_enabled": False}
        requires_factor = await submit("PUT", json={**body, "public_enabled": True})
        assert requires_factor.status_code == 409
        bridge.lose_receipt = True
        saved = await submit("PUT", json=body)
        assert saved.status_code == 200 and saved.json()["host_label"] == "After", saved.text
        await worker.poll_once()
        assert not list(worker.receipts.pending())
        assert "After" in config.read_text() and saved.json()["revision"] != body["revision"]
        assert projection.read()["fpl_cloud_control_host_label"] == "After"
        status = await api.get(
            CLOUD_STATUS, headers=await authorize(case, "remote", "GET", CLOUD_STATUS)
        )
        assert status.json()["enabled"] and status.json()["host_label"] == "After"
        assert (await submit("PUT", json=body)).status_code == 409

        confirmations = 0

        async def revoke_before_write():
            nonlocal confirmations
            confirmations += 1
            if confirmations == 2:
                logout = await case.browser.post(
                    "/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": case.csrf}
                )
                assert logout.status_code == 204, logout.text

        bridge.on_authorize = revoke_before_write
        denied = await submit(
            "PUT", json={**body, "revision": saved.json()["revision"], "host_label": "Forbidden"}
        )
        assert denied.status_code == 403 and "Forbidden" not in config.read_text()
        async with app.state.database.sessions(info={"owner_user_id": owner}) as db:
            rows = list(await db.scalars(select(RemoteSetupJob)))
            assert all("assertion" not in row.payload for row in rows)
            assert {row.status for row in rows} == {"completed", "failed"}


CLOUD_STATUS = "/v1/cloud-control/status"
