"""Verify the owned Remote service against a real TCP Guacamole fixture."""

import asyncio
from pathlib import Path

import httpx
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.console.cloud_control.desktop_bridge import GuacdReader, instruction
from app.runtime.config import get_settings
from fpl_identity.accounts import create_account
from fpl_remote.application import create_app
from fpl_remote.migrations.registry import MIGRATIONS
from fpl_remote.settings import RemoteSettings
from fpl_runtime.claims import HEADER
from fpl_runtime.cloud_authority import DESKTOP_COOKIE, DESKTOP_SOCKET
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:19000"
CLOUD = "/v1/cloud-control"
CREDENTIAL = "remote-service-identity-credential-fixture"


async def websocket(app, assertion, *, origin=ORIGIN):
    outgoing, incoming = asyncio.Queue(), asyncio.Queue()
    incoming.put_nowait({"type": "websocket.connect"})
    task = asyncio.create_task(
        app(
            {
                "type": "websocket",
                "scheme": "ws",
                "path": DESKTOP_SOCKET,
                "query_string": b"",
                "root_path": "",
                "subprotocols": ["guacamole"],
                "headers": [(b"origin", origin.encode()), (HEADER.encode(), assertion.encode())],
                "state": {},
                "client": ("127.0.0.1", 10000),
            },
            incoming.get,
            outgoing.put,
        )
    )
    return task, incoming, outgoing


async def test_remote_owns_preferences_and_revokes_consumed_websocket(
    scenario,  # noqa: F811
    monkeypatch,
    tmp_path,
):
    case = scenario
    async with case.identity.state.database.sessions() as db:
        account, _ = await create_account(
            db,
            username="remote-admin",
            display_name="Remote Admin",
            password=PASSWORD,
            platform_role="admin",
        )
    monkeypatch.setattr(get_settings(), "fpl_cloud_control_enabled", True)
    monkeypatch.setattr(get_settings(), "fpl_cloud_control_admin_user_ids", account.id)
    case.identity.state.identity_options["service_credentials"]["remote"] = CREDENTIAL
    logged = await case.browser.post(
        "/v1/auth/login", json={"username": "remote-admin", "password": PASSWORD}
    )
    assert logged.status_code == 200
    case.csrf = case.browser.cookies["fpl_csrf"]
    root = tmp_path / "remote"
    apply(root / "service.db", "remote", MIGRATIONS)
    keys = asyncio.Queue()

    async def guacd(reader, writer):
        stream = GuacdReader(reader)
        try:
            assert (await stream.next())[0] == ["select", "vnc"]
            writer.write(instruction("args", "VERSION_1_5_0", "hostname", "password"))
            await writer.drain()
            for _ in range(6):
                fields, _ = await stream.next()
            assert fields == ["connect", "VERSION_1_5_0", "host.docker.internal", "fixture-secret"]
            writer.write(instruction("ready", "fixture") + instruction("sync", "0"))
            await writer.drain()
            await keys.put((await stream.next())[0])
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(guacd, "127.0.0.1", 0)
    settings = RemoteSettings(
        ORIGIN,
        guacd_host="127.0.0.1",
        fpl_cloud_control_guacd_port=server.sockets[0].getsockname()[1],
    )

    def application():
        return create_app(
            state_root=root,
            settings=settings,
            credential=CREDENTIAL,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            transport=case.mesh,
            schema_path=ROOT / "web/src/generated/openapi.json",
        )

    async def call(api, method, path, **kwargs):
        headers = await authorize(case, "remote", method, path)
        return await api.request(method, path, headers=headers, **kwargs)

    app = application()
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as api,
        asyncio.timeout(15),
    ):
        status = (await call(api, "GET", CLOUD + "/status")).json()
        assert status["desktop_authorized"] and status["idle_minutes"] == 30
        assert (await api.get("/ready")).status_code == 503
        response = await call(
            api, "PUT", CLOUD + "/desktop/idle", json={"idle_minutes": 8, "revision": 0}
        )
        assert response.json() == {"idle_minutes": 8, "revision": 1}
        conflict = await call(
            api, "PUT", CLOUD + "/desktop/idle", json={"idle_minutes": 9, "revision": 0}
        )
        assert conflict.status_code == 409

    restarted = application()
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted), base_url=ORIGIN) as api,
        server,
        asyncio.timeout(15),
    ):
        status = (await call(api, "GET", CLOUD + "/status")).json()
        assert status["idle_minutes"] == 8 and status["idle_revision"] == 1
        issued = await call(
            api, "POST", CLOUD + "/desktop/connect", json={"password": "fixture-secret"}
        )
        assert issued.status_code == 204 and "HttpOnly" in issued.headers["set-cookie"]
        case.browser.cookies.set(DESKTOP_COOKIE, issued.cookies[DESKTOP_COOKIE])
        proof = await case.browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": "remote",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": DESKTOP_SOCKET,
                "X-Fpl-Request-Protocol": "websocket",
            },
        )
        assert proof.status_code == 204
        token = proof.headers[HEADER]
        bad, _, out = await websocket(restarted, token, origin="https://untrusted.test")
        assert (await out.get())["code"] == 4403
        await bad
        task, incoming, out = await websocket(restarted, token)
        try:
            assert (await out.get())["subprotocol"] == "guacamole"
            await out.get()  # Guacamole tunnel identifier.
            assert (await out.get())["text"] == "4.sync,1.0;"
            await incoming.put({"type": "websocket.receive", "text": "3.key,2.97,1.1;"})
            assert await keys.get() == ["key", "97", "1"]
            duplicate, _, duplicate_out = await websocket(restarted, token)
            assert (await duplicate_out.get())["code"] == 4403
            await duplicate
            revoked = await case.browser.post(
                "/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": case.csrf}
            )
            assert revoked.status_code == 204
            assert "desktop_authorization_required" in (await out.get())["text"]
            assert (await out.get())["type"] == "websocket.close"
            await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
