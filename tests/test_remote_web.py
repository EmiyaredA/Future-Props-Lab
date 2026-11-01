"""Public and Electron sockets share one isolated runtime, never desktop credentials."""

from __future__ import annotations

import io
import socket

import httpx
import pytest
from cryptography.fernet import Fernet
from PIL import Image

from app.runtime.config import Settings
from fpl_config import ConfigurationError, read_config
from test_desktop import DesktopServer, initialize, login

pytestmark = pytest.mark.real_auth
ORIGIN = "https://studio.example.test"


@pytest.fixture
def studio(tmp_path):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    config = tmp_path / "data/backend/config.toml"
    config.parent.mkdir(parents=True)
    config.write_text(
        f'[security]\nsecrets_key = "{Fernet.generate_key().decode()}"\n'
        f'[remote_web]\nenabled = true\norigin = "{ORIGIN}"\nport = {port}\n'
    )
    server = DesktopServer(tmp_path)
    client = httpx.Client(
        base_url=f"http://127.0.0.1:{port}",
        headers={"Host": "studio.example.test", "Origin": ORIGIN},
        timeout=20,
        trust_env=False,
    )
    try:
        yield server, client
    finally:
        client.close()
        server.close()


def public_login(client, username="desktop-admin", password="Local-test-49017!"):
    result = client.post(
        "/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert result.status_code == 200, result.text
    apply_remote_cookies(client, result)


def apply_remote_cookies(client, result):
    cookies = result.headers.get_list("set-cookie")
    assert len(cookies) == 2 and all("; Secure" in value for value in cookies)
    assert "HttpOnly" in next(value for value in cookies if value.startswith("fpl_session="))
    assert all("Domain=" not in value for value in cookies)
    # Physical transport is HTTP on loopback; emulate the TLS proxy/browser cookie.
    client.headers["Cookie"] = "; ".join(value.split(";", 1)[0] for value in cookies)
    client.headers["X-CSRF-Token"] = client.cookies["fpl_csrf"]


def test_other_account_cannot_read_project_or_asset(studio):
    server, client = studio
    assert initialize(server).status_code == 200
    public_login(client)
    project = client.post(
        "/v1/visual-workshop/projects", json={"title": "私人项目", "kind": "image"}
    ).json()
    image = io.BytesIO()
    Image.new("RGB", (16, 16), "blue").save(image, format="PNG")
    asset = client.post(
        "/v1/files", files={"upload": ("private.png", image.getvalue(), "image/png")}
    ).json()
    created = client.post(
        "/v1/platform/accounts",
        json={"username": "separate-user", "display_name": "隔离测试", "platform_role": "user"},
    )
    assert created.status_code == 201, created.text
    temporary = created.json()["temporary_password"]
    public_login(client, "separate-user", temporary)
    changed = client.post(
        "/v1/auth/change-password",
        json={"current_password": temporary, "new_password": "Separate-test-6831!"},
    )
    assert changed.status_code == 204, changed.text
    apply_remote_cookies(client, changed)
    assert client.get(f"/v1/visual-workshop/projects/{project['id']}").status_code == 404
    assert client.get(f"/v1/files/{asset['id']}/content").status_code == 404
    assert client.get("/v1/platform/accounts").status_code == 403


@pytest.mark.asyncio
async def test_websocket_forwarding_and_stream_disconnect_never_retry():
    from app.runtime.remote_web import RemoteWeb

    calls = []
    messages = []

    async def authenticate(scope, _receive):
        assert all(not name.startswith(b"x-fpl-") for name, _ in scope["headers"])

    async def upstream(scope, _receive, send):
        calls.append(scope["type"])
        if scope["type"] == "websocket":
            assert scope["scheme"] == "wss"
            await send({"type": "websocket.accept"})
            await send({"type": "websocket.close", "code": 1000})
        else:
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"text/event-stream")],
                }
            )
            await send({"type": "http.response.body", "body": b"data: once\n\n", "more_body": True})
            raise ConnectionError("simulated browser disconnect")

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    remote = RemoteWeb(origin=ORIGIN, port=28081, static=None, authenticate=authenticate)
    scope = {
        "type": "websocket",
        "path": "/v1/model-test/realtime",
        "server": ("127.0.0.1", 28081),
        "headers": [
            (b"host", b"studio.example.test"),
            (b"origin", ORIGIN.encode()),
            (b"x-fpl-desktop-token", b"forged"),
        ],
    }
    assert remote.accepts(scope)
    assert not remote.accepts({**scope, "server": ("127.0.0.1", 9999)})
    await remote(upstream, scope, receive, send)
    assert messages[0]["type"] == "websocket.accept"
    await remote(
        upstream,
        {
            **scope,
            "headers": [(b"host", b"studio.example.test"), (b"origin", b"https://evil.invalid")],
        },
        receive,
        send,
    )
    assert messages[-1] == {"type": "websocket.close", "code": 1008}
    with pytest.raises(ConnectionError):
        await remote(
            upstream,
            {**scope, "type": "http", "method": "GET", "path": "/v1/events"},
            receive,
            send,
        )
    assert calls == ["websocket", "http"]
    assert sum(message.get("body") == b"data: once\n\n" for message in messages) == 1


def test_same_accounts_projects_uploads_and_range_without_private_token(studio):
    server, client = studio
    assert client.get("/", headers={"Accept": "text/html"}).status_code == 200
    assert (
        client.get("/apps/visual-workshop/example", headers={"Accept": "text/html"}).status_code
        == 200
    )
    assert client.get("/assets/missing.js", headers={"Accept": "text/html"}).status_code == 404
    assert client.get("/v1/auth/me").status_code == 401
    assert initialize(server).status_code == 200
    public_login(client)
    assert client.get("/v1/auth/me").json()["user"]["username"] == "desktop-admin"
    project = client.post(
        "/v1/visual-workshop/projects", json={"title": "公网同库测试", "kind": "image"}
    )
    assert project.status_code in {200, 201}, project.text
    login(server)
    assert (
        server.client.get(f"/v1/visual-workshop/projects/{project.json()['id']}").status_code == 200
    )
    image = io.BytesIO()
    Image.new("RGB", (32, 32), "green").save(image, format="PNG")
    upload = client.post("/v1/files", files={"upload": ("test.png", image.getvalue(), "image/png")})
    assert upload.status_code == 200, upload.text
    url = f"/v1/files/{upload.json()['id']}/content"
    ranged = client.get(url, headers={"Range": "bytes=0-15"})
    assert ranged.status_code == 206 and ranged.content == image.getvalue()[:16]
    assert ranged.headers["cache-control"] == "no-store"
    assert client.post("/v1/auth/logout").status_code == 204
    assert client.get(url).status_code == 401


def test_public_transport_rejects_desktop_spoofing_host_origin_csrf_and_bearer(studio):
    server, client = studio
    for path in (
        "/v1/desktop/setup",
        "/v1/desktop/agent/pairings",
        "/v1/desktop/ui/inbox",
        "/docs",
        "/openapi.json",
        "/v1/auth/register",
    ):
        result = client.get(
            path, headers={"x-fpl-desktop-token": server.client.headers["x-fpl-desktop-token"]}
        )
        assert result.status_code == 404, path
    assert client.get("/", headers={"Host": "evil.invalid"}).status_code == 403
    assert (
        client.post(
            "/v1/auth/login", headers={"Origin": "https://evil.invalid"}, json={}
        ).status_code
        == 403
    )
    assert initialize(server).status_code == 200
    assert (
        client.get(
            "/v1/files", headers={"Authorization": "Bearer fpm_forged", "x-fpl-agent-channel": "1"}
        ).status_code
        == 401
    )
    public_login(client)
    assert (
        client.post(
            "/v1/visual-workshop/projects",
            headers={"X-CSRF-Token": "wrong"},
            json={"title": "deny", "kind": "image"},
        ).status_code
        == 403
    )
    assert client.get("/ready").status_code == 200
    assert httpx.get(server.origin + "/ready").status_code == 403


def test_remote_web_default_closed_and_configuration_validated(tmp_path):
    assert not Settings(_config_file=None).fpl_remote_web_enabled
    for origin in (
        "http://studio.example",
        "https://studio.example/",
        "https://user:secret@studio.example",
        "https://studio.example/path",
    ):
        config = tmp_path / "config.toml"
        config.write_text(f'[remote_web]\nenabled = true\norigin = "{origin}"\n')
        values = read_config(config)
        values["fpl_secrets_key"] = Fernet.generate_key().decode()
        with pytest.raises(ConfigurationError):
            Settings.validate_file_values(values)
