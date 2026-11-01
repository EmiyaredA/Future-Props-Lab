"""Desktop access uses isolated data, actual loopback sockets and fake SSH processes."""

import asyncio
import hashlib
import io
import shlex
import socket
import subprocess
import sys
import tomllib
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet
from PIL import Image
from starlette.applications import Starlette

from app.capabilities.web_access.contracts import AccessConfigIn, GatewayProfile
from app.capabilities.web_access.profiles import AccessError
from app.capabilities.web_access.runtime import WebAccess
from app.runtime.config import Settings
from test_desktop import ROOT, TOKEN, DesktopServer, initialize, login

pytestmark = pytest.mark.real_auth


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def access(tmp_path):
    port = free_port()
    directory = tmp_path / "data/backend"
    directory.mkdir(parents=True)
    (directory / "config.toml").write_text(
        f'[security]\nsecrets_key = "{Fernet.generate_key().decode()}"\n'
        f'[remote_web]\nenabled = true\nport = {port}\norigin = "https://studio.test"\n'
    )
    server = DesktopServer(tmp_path)
    (tmp_path / "web/build.json").write_text('{"build_id":"test-release"}')
    assert initialize(server).status_code == 200
    login(server)
    try:
        yield server, port
    finally:
        server.close()


def test_default_off_idempotent_local_start_stop_and_private_boundary(access):
    server, port = access
    client = server.client
    assets = server.directory / "web/assets"
    assets.mkdir()
    (assets / "app-12345678.js").write_text("console.log('program')")
    assert client.get("/v1/desktop/web-access").json()["local"]["phase"] == "off"
    for _ in range(2):
        result = client.post("/v1/desktop/web-access/actions", json={"action": "local_start"})
        assert result.status_code == 200, result.text
    with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False) as browser:
        assert browser.get("/").status_code == 200
        assert browser.get("/").headers["cache-control"] == "no-cache"
        resource = browser.get("/assets/app-12345678.js")
        assert "immutable" in resource.headers["cache-control"]
        cached = browser.get(
            "/assets/app-12345678.js", headers={"If-None-Match": resource.headers["etag"]}
        )
        assert cached.status_code == 304 and not cached.content
        assert browser.get("/v1/auth/me").status_code == 401
        assert browser.get("/v1/desktop/web-access").status_code == 404
        assert browser.get("/ready", headers={"Host": "studio.test"}).status_code == 503
        logged = browser.post(
            "/v1/auth/login",
            headers={"Origin": str(browser.base_url).rstrip("/")},
            json={"username": "desktop-admin", "password": "Local-test-49017!"},
        )
        assert logged.status_code == 200, logged.text
        assert all("; Secure" not in c for c in logged.headers.get_list("set-cookie"))
        assert (
            browser.get("/v1/auth/me").json()["user"]["id"]
            == client.get("/v1/auth/me").json()["user"]["id"]
        )
    result = client.post("/v1/desktop/web-access/actions", json={"action": "local_stop"})
    assert result.json()["public"]["phase"] == "off"
    with pytest.raises(httpx.TransportError):
        httpx.get(f"http://127.0.0.1:{port}/ready", trust_env=False, timeout=1)
    assert client.get("/ready").status_code == 200


def test_config_requires_admin_native_receipt_and_cas(access):
    server, _ = access
    client = server.client
    config = client.get("/v1/desktop/web-access/config").json()
    payload = {"expected_revision": "0" * 64, "profile": config["profile"]}
    assert client.put("/v1/desktop/web-access/config", json=payload).status_code == 409
    payload["expected_revision"] = config["revision"]
    result = client.put("/v1/desktop/web-access/config", json=payload)
    assert result.status_code == 200, result.text
    receipt = result.json()["apply_receipt"]
    assert (
        client.post("/v1/desktop/web-access/config/claim", json={"receipt": receipt}).status_code
        == 404
    )
    native = {
        "x-fpl-native-web-access": hashlib.sha256(("web-access:" + TOKEN).encode()).hexdigest()
    }
    claimed = client.post(
        "/v1/desktop/web-access/config/claim", headers=native, json={"receipt": receipt}
    )
    assert claimed.status_code == 200
    assert claimed.json()["profile"] == config["profile"]
    assert (
        client.post(
            "/v1/desktop/web-access/config/claim", headers=native, json={"receipt": receipt}
        ).status_code
        == 403
    )
    assert client.get("/v1/desktop/web-access/config").json()["revision"] == config["revision"]
    client.headers["X-CSRF-Token"] = "wrong"
    assert (
        client.post("/v1/desktop/web-access/actions", json={"action": "local_start"}).status_code
        == 403
    )
    client.cookies.clear()
    client.headers.pop("X-CSRF-Token")
    assert client.get("/v1/desktop/web-access").status_code == 401


def test_private_thumbnail_sizes_and_original_is_unchanged(access):
    server, _ = access
    source = io.BytesIO()
    Image.new("RGB", (1200, 900), "blue").save(source, format="PNG")
    client = server.client
    asset = client.post(
        "/v1/files", files={"upload": ("photo.png", source.getvalue(), "image/png")}
    ).json()
    for size in (320, 640):
        response = client.get(f"/v1/files/{asset['id']}/thumbnail?size={size}")
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "private, no-store"
        assert Image.open(io.BytesIO(response.content)).size == (size, size * 3 // 4)
    assert client.get(f"/v1/files/{asset['id']}/thumbnail?size=4096").status_code == 422
    assert client.get(f"/v1/files/{asset['id']}/content").content == source.getvalue()


def controller(tmp_path, *, port=None):
    (tmp_path / "backend").mkdir(exist_ok=True)
    (tmp_path / "backend/config.toml").write_text("# test\n")
    (tmp_path / "build.json").write_text('{"build_id":"test-release"}')
    settings = Settings(
        _config_file=None,
        fpl_remote_web_port=port or free_port(),
        fpl_remote_web_origin="https://studio.test",
    )

    async def authenticate(*_):
        pass

    return WebAccess(Starlette(), settings, tmp_path, tmp_path, authenticate)


@pytest.mark.asyncio
async def test_port_conflict_and_build_mismatch_do_not_enable_public(tmp_path, monkeypatch):
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        runtime = controller(tmp_path, port=occupied.getsockname()[1])
        with pytest.raises(AccessError, match="端口"):
            await runtime.action("local_start")
        assert runtime.local.phase == "failed"
        assert runtime.sock is None

    async def mismatch():
        raise AccessError("版本不匹配")

    monkeypatch.setattr(runtime, "validate_credentials", lambda: None)
    monkeypatch.setattr(runtime, "check_build", mismatch)
    with pytest.raises(AccessError, match="版本"):
        await runtime.action("public_start")
    assert not runtime.public_enabled and runtime.tunnel_task is None
    await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("folder", ["Future Props Lab", 'Future "Props" Lab'])
async def test_ssh_retry_strict_options_and_stop_cancels_retry(tmp_path, monkeypatch, folder):
    directory = tmp_path / folder
    directory.mkdir()
    runtime = controller(directory)
    runtime.profile = GatewayProfile(
        origin="https://studio.test",
        host="gateway.test",
        user="fpl-gateway",
        identity_id="a" * 32,
        known_hosts_id="b" * 32,
    )
    runtime.store.credentials.mkdir(parents=True)
    for identity, kind in [("a" * 32, "identity"), ("b" * 32, "known_hosts")]:
        runtime.store.credential_path(identity, kind).write_text("test")
    calls = []
    child = SimpleNamespace(returncode=1)

    async def spawn(*args, **_kwargs):
        calls.append(args)
        return child

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    runtime.public_enabled = True
    runtime.tunnel_task = asyncio.create_task(runtime.follow_tunnel())
    await asyncio.sleep(1.1)
    assert calls and "StrictHostKeyChecking=yes" in calls[0] and "-N" in calls[0]
    assert "127.0.0.1:28080:127.0.0.1:28081" in calls[0]
    # SSH parses this -o value as a list of config tokens, even with argv transport.
    hosts_option = next(arg for arg in calls[0] if arg.startswith("UserKnownHostsFile="))
    assert shlex.split(hosts_option.split("=", 1)[1]) == [
        str(runtime.store.credential_path("b" * 32, "known_hosts"))
    ]
    assert runtime.public.phase == "reconnecting"
    await runtime.action("public_stop")
    before = len(calls)
    await asyncio.sleep(1.1)
    assert len(calls) == before and runtime.tunnel_task is None


def test_credentials_are_native_only_and_fingerprints_are_redacted(access, tmp_path):
    server, _ = access
    key = tmp_path / "id_ed25519"
    subprocess.run(
        ["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True
    )
    client = server.client
    ticket = client.post(
        "/v1/desktop/web-access/credentials/tickets", json={"kind": "identity"}
    ).json()["ticket"]
    body = {"ticket": ticket, "path": str(key)}
    assert client.post("/v1/desktop/web-access/credentials/import", json=body).status_code == 404
    headers = {
        "x-fpl-native-web-access": hashlib.sha256(("web-access:" + TOKEN).encode()).hexdigest()
    }
    imported = client.post("/v1/desktop/web-access/credentials/import", headers=headers, json=body)
    assert imported.status_code == 200, imported.text
    assert imported.json()["fingerprint"].startswith("SHA256:")
    assert "PRIVATE" not in imported.text and str(key) not in imported.text
    owned = tmp_path / f"data/backend/web-access/credentials/{imported.json()['id']}.identity"
    assert owned.stat().st_mode & 0o777 == 0o600
    assert owned.parent.stat().st_mode & 0o777 == 0o700
    assert (
        client.post(
            "/v1/desktop/web-access/credentials/import", headers=headers, json=body
        ).status_code
        == 403
    )


def test_offline_config_has_verified_backup_and_preserves_key(tmp_path):
    sys.path.insert(0, str(ROOT / "desktop/backend"))
    from web_config import apply_profile

    root = tmp_path / "App"
    config = root / "backend/config.toml"
    config.parent.mkdir(parents=True)
    key = Fernet.generate_key().decode()
    config.write_text(f'[security]\nsecrets_key="{key}"\n')
    (root / "runtime/accounts").mkdir(parents=True)
    (root / "runtime/accounts/private.txt").write_text("private")
    payload = {
        "expected_revision": hashlib.sha256(config.read_bytes()).hexdigest(),
        "profile": GatewayProfile(local_port=28199).model_dump(),
    }
    apply_profile(root, payload)
    document = tomllib.loads(config.read_text())
    assert document["remote_web"]["port"] == 28199 and not document["remote_web"]["enabled"]
    assert document["security"]["secrets_key"] == key
    backup = next(tmp_path.glob("App Development Backup*"))
    assert (backup / "complete.json").is_file()
    assert (backup / "runtime/accounts/private.txt").read_text() == "private"
    with pytest.raises(ValueError, match="已改变"):
        apply_profile(root, payload)


def test_profile_rejects_injection_and_tickets_are_one_use(tmp_path):
    store = controller(tmp_path).store
    token = store.ticket("config", {"safe": True})
    assert store.claim(token, "config") == {"safe": True}
    with pytest.raises(AccessError):
        store.claim(token, "config")
    for data in [
        {"host": "-oProxyCommand=bad"},
        {"user": "bad; shell"},
        {"origin": "https://user:pass@example.test"},
    ]:
        with pytest.raises(ValueError):
            GatewayProfile(**data)
    with pytest.raises(AccessError):
        store.prepare(AccessConfigIn(expected_revision="0" * 64, profile=GatewayProfile()))


def test_key_agent_and_revoked_session_cannot_manage_access(access):
    server, _ = access
    client = server.client
    created = client.post(
        "/v1/account/api-keys",
        json={"name": "access-rejected", "scopes": ["studio:read", "studio:write"]},
    )
    assert created.status_code == 201, created.text
    with httpx.Client(
        base_url=server.origin,
        headers={
            "x-fpl-desktop-token": TOKEN,
            "Authorization": "Bearer " + created.json()["secret"],
        },
        trust_env=False,
    ) as key:
        assert key.get("/v1/desktop/web-access").status_code == 403
        assert (
            key.get("/v1/desktop/web-access", headers={"x-fpl-agent-channel": "1"}).status_code
            == 403
        )
    config = client.get("/v1/desktop/web-access/config").json()
    receipt = client.put(
        "/v1/desktop/web-access/config",
        json={"expected_revision": config["revision"], "profile": config["profile"]},
    ).json()["apply_receipt"]
    login(server)
    native = {
        "x-fpl-native-web-access": hashlib.sha256(("web-access:" + TOKEN).encode()).hexdigest()
    }
    assert (
        client.post(
            "/v1/desktop/web-access/config/claim", headers=native, json={"receipt": receipt}
        ).status_code
        == 403
    )
    assert client.post("/v1/auth/logout").status_code == 204
    assert client.get("/v1/desktop/web-access").status_code == 401


@pytest.mark.asyncio
async def test_ssh_fingerprint_failure_is_terminal_and_never_trusted(tmp_path, monkeypatch):
    runtime = controller(tmp_path)
    runtime.profile = GatewayProfile(
        host="host.test",
        user="fpl",
        origin="https://studio.test",
        identity_id="a" * 32,
        known_hosts_id="b" * 32,
    )
    runtime.store.credentials.mkdir(parents=True)
    for identity, kind in [("a" * 32, "identity"), ("b" * 32, "known_hosts")]:
        runtime.store.credential_path(identity, kind).write_text("test")

    async def diagnostic(_size):
        return b"Host key verification failed."

    async def spawn(*_args, **_kwargs):
        return SimpleNamespace(returncode=255, stderr=SimpleNamespace(read=diagnostic))

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    runtime.public_enabled = True
    await runtime.follow_tunnel()
    assert runtime.public.phase == "failed" and "指纹" in runtime.public.error
    assert not runtime.public_enabled


def test_entry_applies_config_offline_then_restarts_with_access_closed(tmp_path):
    original = DesktopServer(tmp_path)
    assert initialize(original).status_code == 200
    original.close()
    config = tmp_path / "data/backend/config.toml"
    before = tomllib.loads(config.read_text())["security"]["secrets_key"]
    payload = {
        "expected_revision": hashlib.sha256(config.read_bytes()).hexdigest(),
        "profile": GatewayProfile(local_port=free_port()).model_dump(),
    }
    updated = DesktopServer(tmp_path, web_config=payload)
    try:
        login(updated)
        assert updated.client.get("/v1/desktop/web-access").json()["local"]["phase"] == "off"
        current = tomllib.loads(config.read_text())
        assert current["security"]["secrets_key"] == before
        assert current["remote_web"]["port"] == payload["profile"]["local_port"]
        assert list(tmp_path.glob("data Development Backup */complete.json"))
    finally:
        updated.close()
