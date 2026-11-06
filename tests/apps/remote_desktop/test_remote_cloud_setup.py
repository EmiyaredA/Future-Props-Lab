"""Exercise trusted-local settings through the independently leased Mac coordinator."""

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from dataclasses import replace

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import select

from studio.apps.identity.accounts import create_account
from studio.apps.remote_desktop.settings import RemoteSettings
from studio.apps.remote_desktop.storage.migrations.registry import MIGRATIONS
from studio.apps.remote_desktop.storage.service_models import RemoteSetupJob
from studio.assembly.independent.remote_desktop.application import create_app
from studio.config.cloud_projection import CloudProjection
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.contracts.remote_desktop.apps import APP_PROTOCOL, APP_SOCKET, APPS_PATH, RemoteApp
from studio.contracts.remote_desktop.setup import SETTINGS_PATH
from studio.host.deployment.cloud_setup_worker import CloudSetupWorker
from studio.host.remote_apps import relay as host_relay
from studio.host.remote_apps import setup as host_apps
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions
from tests.apps.remote_desktop.test_remote_service import websocket
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

CREDENTIAL = "isolated-remote-service-credential-" * 2
INGRESS = "isolated-remote-ingress-credential-" * 2
TOKEN = "isolated-remote-mac-credential-" * 2
ORIGIN = "http://127.0.0.1:19000"


async def test_remote_apps_route_setup_and_revocable_window_relay(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    async with case.identity.state.database.sessions() as db:
        account, _ = await create_account(
            db,
            username="app-admin",
            display_name="App Admin",
            password=PASSWORD,
            platform_role="admin",
        )
        owner = account.id
    case.identity.state.identity_options["service_credentials"]["remote"] = CREDENTIAL
    result = await case.browser.post(
        "/v1/auth/login", json={"username": "app-admin", "password": PASSWORD}
    )
    assert result.status_code == 200, result.text
    case.csrf = case.browser.cookies["fpl_csrf"]
    headers = {"Origin": ORIGIN, "X-CSRF-Token": case.csrf}
    host = tmp_path / "mac"
    host.mkdir()
    config = host / "config.toml"
    config.write_text(
        f"[cloud_control]\nenabled = true\nadmin_user_ids = [{json.dumps(owner)}]\n"
        f"apps_enabled = true\napps_host = {json.dumps(sys.executable)}\n"
        f"[security]\nsecrets_key = '{Fernet.generate_key().decode()}'\n"
    )
    projections = host / "projections"
    projections.mkdir()
    monkeypatch.setenv("FPL_IDENTITY_CLOUD_PROJECTION_DIR", str(projections / "identity"))
    monkeypatch.setenv("FPL_CLOUD_SETTINGS_COMMIT_DIR", str(projections / "committed"))
    projection = CloudProjection("remote", projections / "remote", projections / "committed")
    root = tmp_path / "remote"
    apply(root / "service.db", "remote", MIGRATIONS)
    app = create_app(
        state_root=root,
        settings=RemoteSettings(ORIGIN),
        public_key=case.key.public_key(),
        credential=CREDENTIAL,
        catalog=CATALOG,
        transport=case.mesh,
        cloud_projection=projection,
        setup_options=NativeWorkerOptions(
            identity_credential=CREDENTIAL,
            ingress=INGRESS,
            workers={"mac": TOKEN},
        ),
    )
    native = NativeTransport(
        service="remote",
        base_url=ORIGIN + "/remote",
        credential=TOKEN,
        transport=Bridge(app),
    )
    worker = CloudSetupWorker(native, config, projections, host)
    app_id = "a" * 64
    other_id = "b" * 64

    async def catalog(_path):
        return [RemoteApp(id=app_id, name="Fixture window"), RemoteApp(id=other_id, name="Hidden")]

    @asynccontextmanager
    async def fake_window(_path, command, target):
        assert (command, target) == ("session", app_id)
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-u",
            "-c",
            "import json,sys; input(); assert json.loads(input())['type']=='offer'; "
            "print(json.dumps({'type':'answer','sdp':'v=0'})); sys.stdin.read()",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
        )
        try:
            yield process
        finally:
            process.stdin.close()
            await process.wait()

    monkeypatch.setattr(host_apps, "installed_apps", catalog)
    monkeypatch.setattr(host_relay, "run_host", fake_window)

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as api,
        asyncio.timeout(35),
    ):
        background = asyncio.create_task(worker.run())
        try:
            while (await api.get("/ready")).status_code != 200:
                await asyncio.sleep(0.05)

            async def call(method, path, **kwargs):
                proof = await authorize(case, "remote", method, path)
                return await api.request(method, path, headers=proof, **kwargs)

            installed = await call("GET", APPS_PATH + "/installed")
            assert installed.status_code == 200, installed.text
            edit = {"revision": installed.json()["revision"], "app_ids": [app_id]}
            assert (await call("PUT", APPS_PATH, json=edit)).status_code == 403
            assert (
                await case.browser.post(
                    "/v1/auth/reauth", json={"password": PASSWORD}, headers=headers
                )
            ).status_code == 204
            saved = await call("PUT", APPS_PATH, json=edit)
            assert saved.status_code == 200 and saved.json()["allowed_ids"] == [app_id], saved.text
            listed = await call("GET", APPS_PATH)
            assert [item["id"] for item in listed.json()["apps"]] == [app_id]
            assert (await call("PUT", APPS_PATH, json=edit)).status_code == 409
            assert (
                await call("POST", APPS_PATH + "/connect", json={"app_id": other_id})
            ).status_code == 404
            issued = await call("POST", APPS_PATH + "/connect", json={"app_id": app_id})
            assert issued.status_code == 200, issued.text
            proof = await case.browser.get(
                "/_internal/v1/authorize",
                headers={
                    "X-Fpl-Target-Service": "remote",
                    "X-Fpl-Request-Method": "GET",
                    "X-Fpl-Request-Uri": APP_SOCKET,
                    "X-Fpl-Request-Protocol": "websocket",
                },
            )
            assert proof.status_code == 204, proof.text
            task, incoming, outgoing = await websocket(
                app,
                proof.headers[HEADER],
                path=APP_SOCKET,
                protocol=APP_PROTOCOL,
            )
            try:
                assert (await outgoing.get())["subprotocol"] == APP_PROTOCOL
                await incoming.put(
                    {
                        "type": "websocket.receive",
                        "text": json.dumps({"ticket": issued.json()["ticket"]}),
                    }
                )
                await incoming.put(
                    {
                        "type": "websocket.receive",
                        "text": '{"type":"offer","sdp":"v=0"}',
                    }
                )
                assert json.loads((await outgoing.get())["text"]) == {
                    "type": "answer",
                    "sdp": "v=0",
                }
                assert (
                    await case.browser.post("/v1/auth/logout", headers=headers)
                ).status_code == 204
                assert (await outgoing.get())["type"] == "websocket.close"
                await task
                assert app.state.app_relay.window is None
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        finally:
            background.cancel()
            await asyncio.gather(background, return_exceptions=True)


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
        body = {"revision": read.json()["revision"], "host_label": "After", "public_enabled": True}
        reauth = await case.browser.post(
            "/v1/auth/reauth",
            json={"password": PASSWORD},
            headers={"Origin": ORIGIN, "X-CSRF-Token": case.csrf},
        )
        assert reauth.status_code == 204, reauth.text
        bridge.lose_receipt = True
        saved = await submit("PUT", json=body)
        assert saved.status_code == 200 and saved.json()["host_label"] == "After", saved.text
        await worker.poll_once()
        assert not list(worker.receipts.pending())
        assert saved.json()["public_enabled"] and "enrolled" not in saved.json()
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
