"""Desktop transport/lifecycle through formal APIs against isolated temporary data."""

from __future__ import annotations

import concurrent.futures
import io
import json
import os
import selectors
import subprocess
import sys
import time
import tomllib
from pathlib import Path

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from PIL import Image

from app.core.desktop import DESKTOP_HEADER, DesktopTransport

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "desktop-test-credential-" * 3
pytestmark = pytest.mark.real_auth


def test_legacy_configuration_upgrades_in_backend_process(tmp_path):
    config_dir = tmp_path / "data/backend"
    config_dir.mkdir(parents=True)
    key = Fernet.generate_key().decode()
    (config_dir / ".env").write_text(f"FPL_SECRETS_KEY={key}\n")
    server = DesktopServer(tmp_path)
    try:
        assert server.client.get("/ready").status_code == 200
        document = tomllib.loads((config_dir / "config.toml").read_text())
        assert document["security"]["secrets_key"] == key
        assert not (config_dir / ".env").exists()
        assert len(list(config_dir.glob(".env.backup-*"))) == 1
    finally:
        server.close()


class DesktopServer:
    def __init__(self, directory: Path):
        self.directory = directory
        web = directory / "web"
        web.mkdir(exist_ok=True)
        (web / "index.html").write_text("<html>desktop test</html>")
        (web / "docs.html").write_text("<html>docs test</html>")
        self.log = (directory / "test-backend.log").open("ab")
        binary = os.environ.get("FPL_TEST_DESKTOP_BINARY")
        command = [binary] if binary else [sys.executable, str(ROOT / "desktop/backend/entry.py")]
        self.process = subprocess.Popen(
            [*command, "--data-dir", str(directory / "data"), "--web-dir", str(web)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.log,
            cwd="/private/tmp" if sys.platform == "darwin" else "/tmp",
            env={**os.environ, "PATH": "/usr/bin:/bin"},
        )
        self.process.stdin.write((TOKEN + "\n").encode())
        self.process.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            if not selector.select(60):
                self.close()
                raise AssertionError("No private port handshake")
        line = self.process.stdout.readline()
        if not line:
            self.close()
            raise AssertionError((directory / "test-backend.log").read_text())
        port = json.loads(line)["port"]
        self.origin = f"http://127.0.0.1:{port}"
        self.client = httpx.Client(
            base_url=self.origin,
            headers={DESKTOP_HEADER: TOKEN, "Origin": self.origin},
            timeout=20,
        )
        for _ in range(300):
            try:
                if self.client.get("/ready").status_code == 200:
                    return
            except httpx.TransportError:
                pass
            if self.process.poll() is not None:
                break
            time.sleep(0.1)
        self.close()
        raise AssertionError((directory / "test-backend.log").read_text())

    def close(self):
        if hasattr(self, "client"):
            self.client.close()
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
                raise AssertionError("Backend did not stop on parent pipe EOF") from None
        self.log.close()


@pytest.fixture
def desktop(tmp_path):
    server = DesktopServer(tmp_path)
    try:
        yield server
    finally:
        server.close()


def initialize(server):
    return server.client.post(
        "/v1/desktop/setup",
        json={
            "username": "desktop-admin",
            "display_name": "本机管理员",
            "password": "Local-test-49017!",
        },
    )


def login(server):
    response = server.client.post(
        "/v1/auth/login",
        json={
            "username": "desktop-admin",
            "password": "Local-test-49017!",
        },
    )
    assert response.status_code == 200, response.text
    server.client.headers["X-CSRF-Token"] = server.client.cookies["fpl_csrf"]
    return response


def test_setup_concurrency_session_and_restart(desktop):
    assert desktop.client.get("/v1/desktop/setup").json() == {"setup_required": True}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: initialize(desktop).status_code, range(2)))
    assert sorted(results) == [200, 409]
    login(desktop)
    me = desktop.client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["workspace"]["id"] == "default"
    project = desktop.client.post(
        "/v1/visual-workshop/projects", json={"title": "桌面持久化", "kind": "image"}
    )
    assert project.status_code in {200, 201}, project.text
    project_id = project.json()["id"]
    image = io.BytesIO()
    Image.new("RGB", (16, 16), "blue").save(image, format="PNG")
    uploaded = desktop.client.post(
        "/v1/files", files={"upload": ("desktop.png", image.getvalue(), "image/png")}
    )
    assert uploaded.status_code == 200, uploaded.text
    asset_id = uploaded.json()["id"]
    exported = desktop.client.get(f"/v1/visual-workshop/projects/{project_id}/snapshot")
    assert exported.status_code == 200 and exported.content.startswith(b"PK")
    imported = desktop.client.post(
        "/v1/visual-workshop/projects/snapshot-imports",
        files={"file": ("project.zip", exported.content, "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    key = (desktop.directory / "data/backend/config.toml").read_bytes()
    cookies = dict(desktop.client.cookies)
    desktop.close()
    restarted = DesktopServer(desktop.directory)
    try:
        assert (desktop.directory / "data/backend/config.toml").read_bytes() == key
        assert restarted.client.get("/v1/desktop/setup").json() == {"setup_required": False}
        restarted.client.cookies.update(cookies)
        assert restarted.client.get("/v1/auth/me").status_code == 200
        assert restarted.client.get(f"/v1/visual-workshop/projects/{project_id}").status_code == 200
        assert restarted.client.get(f"/v1/files/{asset_id}/content").content == image.getvalue()
    finally:
        restarted.close()


def test_transport_routing_and_csrf(desktop):
    assert httpx.get(desktop.origin + "/ready").status_code == 403
    assert desktop.client.get("/v1/auth/me").status_code == 401
    assert (
        desktop.client.post(
            "/v1/desktop/setup",
            headers={"Origin": "https://evil.invalid"},
            json={
                "username": "administrator",
                "password": "Local-test-49017!",
            },
        ).status_code
        == 403
    )
    assert (
        desktop.client.get("/deep/workshop/project", headers={"Accept": "text/html"}).status_code
        == 200
    )
    for route in ("/v1/not-found", "/assets/missing.js", "/assets/missing"):
        assert desktop.client.get(route, headers={"Accept": "text/html"}).status_code == 404
    assert desktop.client.get("/docs.html").status_code == 200
    assert initialize(desktop).status_code == 200
    login(desktop)
    desktop.client.headers.pop("X-CSRF-Token")
    assert (
        desktop.client.post("/v1/visual-workshop/projects", json={"name": "no-csrf"}).status_code
        == 403
    )


def test_missing_key_fails_without_replacing_data(desktop):
    assert initialize(desktop).status_code == 200
    desktop.close()
    key = desktop.directory / "data/backend/config.toml"
    key.unlink()  # Only this test's isolated configuration.
    with pytest.raises(AssertionError, match="密钥缺失"):
        DesktopServer(desktop.directory)
    assert not key.exists()


def test_same_data_directory_cannot_start_twice(desktop):
    with pytest.raises(AssertionError, match="启动失败"):
        DesktopServer(desktop.directory)
    assert desktop.client.get("/ready").status_code == 200


def test_websocket_credential_boundary():
    from starlette.websockets import WebSocketDisconnect

    # A raw ASGI echo keeps this transport test independent of provider credentials.
    async def echo(_scope, receive, send):
        await receive()
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.send", "text": "ready"})
        await send({"type": "websocket.close", "code": 1000})

    client = TestClient(DesktopTransport(echo, token=TOKEN))
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/socket"):
            pass
    with client.websocket_connect("/socket", headers={DESKTOP_HEADER: TOKEN}) as ws:
        assert ws.receive_text() == "ready"


async def test_regular_web_disables_setup():
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/v1/desktop/setup")).status_code == 404
        assert (await client.post("/v1/desktop/setup", json={})).status_code == 404
        assert (
            await client.post(
                "/v1/desktop/setup",
                json={
                    "username": "administrator",
                    "password": "Local-test-49017!",
                },
            )
        ).status_code == 404


async def test_sse_transport_preserves_stream_chunks():
    sent = []

    async def events(_scope, _receive, send):
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/event-stream")],
            }
        )
        await send({"type": "http.response.body", "body": b"data: first\n\n", "more_body": True})
        await send({"type": "http.response.body", "body": b"data: done\n\n", "more_body": False})

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    await DesktopTransport(events, token=TOKEN)(
        {"type": "http", "headers": [(DESKTOP_HEADER.encode(), TOKEN.encode())]}, receive, send
    )
    assert [part.get("more_body") for part in sent[1:]] == [True, False]
    assert sent[0]["headers"] == [(b"content-type", b"text/event-stream")]
