"""Real desktop backend + Unix gateway + independent CLI/SDK, only temporary data."""

import concurrent.futures
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from tests.test_desktop import TOKEN, DesktopServer, initialize, login

from app.console.governance.desktop_agent import MANIFEST, AgentError, DesktopAgent, allows_agent

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sdk/python/src"))
from future_props_lab import async_desktop_client, desktop_client, pair_desktop  # noqa: E402
from future_props_lab import workshop_examples as recipes  # noqa: E402
from future_props_lab.desktop import credential_path, discover  # noqa: E402

pytestmark = pytest.mark.real_auth


@pytest.fixture
def connected(tmp_path):
    backend = DesktopServer(tmp_path)
    gateway = None
    try:
        assert initialize(backend).status_code == 200
        login(backend)
        data = tmp_path / "data"
        gateway = subprocess.Popen(
            ["node", str(ROOT / "desktop/tests/gateway-runner.cjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        gateway.stdin.write(
            (
                json.dumps(
                    {
                        "dataDir": str(data),
                        "service": {
                            "origin": backend.origin,
                            "token": TOKEN,
                        },
                    }
                )
                + "\n"
            ).encode()
        )
        gateway.stdin.flush()
        import selectors

        with selectors.DefaultSelector() as selector:
            selector.register(gateway.stdout, selectors.EVENT_READ)
            assert selector.select(10), "Gateway did not start"
        assert gateway.stdout.readline() == b"ready\n"
        yield backend, data
    finally:
        if gateway:
            gateway.stdin.close()
            try:
                gateway.wait(10)
            except subprocess.TimeoutExpired:
                gateway.kill()
                gateway.wait()
        backend.close()


def approve(backend, data, *, write=True, profile="default"):
    def pending(pair):
        response = backend.client.post(
            f"/v1/desktop/agent/pairings/{pair['id']}/decision",
            json={"approve": True, "code": pair["code"], "expected_workspace_id": "default"},
        )
        assert response.status_code == 200, response.text
        assert "secret" not in response.text and "api_key" not in response.text

    return pair_desktop(
        name="测试 Agent", write=write, data_dir=data, profile=profile, on_pending=pending
    )


def test_pairing_cli_permissions_revocation_and_streaming(connected):
    backend, data = connected
    result = approve(backend, data, write=False)
    assert "api_key" not in result
    assert credential_path(data_dir=data).stat().st_mode & 0o777 == 0o600
    descriptor = (data / "agent/connection.json").read_text()
    assert TOKEN not in descriptor and "fpm_" not in descriptor
    with desktop_client(data_dir=data) as sdk:
        assert sdk.visual.list_projects().items == []
        from future_props_lab import ApiError

        with pytest.raises(ApiError) as denied:
            sdk.visual.create_project(body={"title": "forbidden", "kind": "image"})
        assert denied.value.status == 403
        with pytest.raises(ApiError):
            sdk.accounts.me()
    command = [sys.executable, "-m", "future_props_lab.cli", "--data-dir", str(data)]
    env = {**os.environ, "PYTHONPATH": str(ROOT / "sdk/python/src")}
    status = subprocess.run([*command, "status"], capture_output=True, text=True, env=env)
    assert status.returncode == 0, status.stderr
    assert json.loads(status.stdout)["workspace_id"] == result["workspace_id"]
    operations = subprocess.run([*command, "operations"], capture_output=True, text=True, env=env)
    names = json.loads(operations.stdout)["operations"]
    assert "visual.create_project" in names and not any(n.startswith("accounts.") for n in names)
    keys = backend.client.get("/v1/account/api-keys").json()
    key = next(k for k in keys if k["id"] == result["key_id"])
    assert (
        backend.client.post(
            f"/v1/account/api-keys/{key['id']}/revoke", json={"expected_revision": key["revision"]}
        ).status_code
        == 200
    )
    revoked = subprocess.run([*command, "status"], capture_output=True, text=True, env=env)
    assert revoked.returncode == 3 and "fpm_" not in revoked.stderr


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind", ["visual", "galgame", "video", "thought", "presentation", "annotation"]
)
async def test_real_desktop_sdk_workshop_round_trip(connected, tmp_path, kind):
    from tests.test_audio_annotation import wav_bytes

    backend, data = connected
    approve(backend, data)
    async with async_desktop_client(data_dir=data) as sdk:
        recipe = getattr(recipes, kind + "_workflow")
        output = tmp_path / "result"
        if kind == "annotation":
            identity, saved = await recipe(sdk, io.BytesIO(wav_bytes()), output)
        else:
            identity, saved = await recipe(sdk, output)
        assert saved.revision >= 1 and output.stat().st_size > 0
        assert backend.client.get("/v1/desktop/ui/inbox").status_code == 200
        opened = await sdk._call(
            "POST",
            "/v1/desktop/ui/open",
            body={
                "kind": "note" if kind == "thought" else kind,
                "resource_id": identity,
            },
            media_type="application/json",
        )
        assert opened["status"] == "pending"
        inbox = backend.client.get("/v1/desktop/ui/inbox").json()
        assert inbox["change_revision"] > 0 and inbox["requests"][0]["id"] == opened["id"]
        ack = backend.client.post(
            f"/v1/desktop/ui/requests/{opened['id']}/ack", json={"status": "opened"}
        )
        assert ack.status_code == 200, ack.text
        assert (await sdk._call("GET", f"/v1/desktop/ui/requests/{opened['id']}"))[
            "status"
        ] == "opened"


def test_gateway_rejects_cookie_origin_credentials_and_unknown_routes(connected):
    _, data = connected
    with httpx.Client(
        base_url="http://fpl.local", transport=httpx.HTTPTransport(uds=discover(data))
    ) as client:
        for header in [
            {"Cookie": "session=bad"},
            {"Origin": "https://evil.invalid"},
            {"x-fpl-desktop-token": "bad"},
        ]:
            assert client.get("/v1/files", headers=header).status_code == 403
        for path in ["/v1/auth/me", "/v1/account/api-keys", "/v1/unknown"]:
            assert client.get(path).status_code == 403
        assert client.get("/v1/files").status_code == 401
        pair = client.post("/v1/desktop/agent/pairings", json={"name": "concurrent"}).json()
        assert (
            client.post(
                f"/v1/desktop/agent/pairings/{pair['id']}/claim", json={"claim_token": "x" * 43}
            ).status_code
            == 403
        )


def test_expiry_rate_limit_and_manifest_default_deny():
    state = DesktopAgent()
    pair = state.begin("test", "studio:read")
    state.pairings[pair["id"]]["expires"] = time.monotonic() - 1
    with pytest.raises(AgentError) as expired:
        state.get_pair(pair["id"])
    assert expired.value.status == 410
    for _ in range(4):
        state.begin("test", "studio:read")
    with pytest.raises(AgentError) as limited:
        state.begin("test", "studio:read")
    assert limited.value.status == 429
    assert allows_agent("GET", "/v1/visual-workshop/projects/a-123")
    assert not allows_agent("POST", "/v1/visual-workshop/new-dangerous-action")
    for operation in MANIFEST["operations"]:
        assert not any(x in operation for x in ("/account/", "/model-providers"))


def test_pair_claim_once_and_decision_csrf(connected):
    backend, data = connected
    with httpx.Client(
        base_url="http://fpl.local", transport=httpx.HTTPTransport(uds=discover(data))
    ) as client:
        pair = client.post("/v1/desktop/agent/pairings", json={"name": "once"}).json()
        path = f"/v1/desktop/agent/pairings/{pair['id']}"
        csrf = backend.client.headers.pop("X-CSRF-Token")
        assert (
            backend.client.post(
                path + "/decision",
                json={"approve": True, "code": pair["code"], "expected_workspace_id": "default"},
            ).status_code
            == 403
        )
        backend.client.headers["X-CSRF-Token"] = csrf
        assert (
            backend.client.post(
                path + "/decision",
                json={
                    "approve": True,
                    "code": pair["code"],
                    "expected_workspace_id": "stale-workspace",
                },
            ).status_code
            == 409
        )

        def decide(_):
            return backend.client.post(
                path + "/decision",
                json={"approve": True, "code": pair["code"], "expected_workspace_id": "default"},
            ).status_code

        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            assert sorted(pool.map(decide, range(2))) == [200, 409]

        def claim(_):
            return client.post(
                path + "/claim", json={"claim_token": pair["claim_token"]}
            ).status_code

        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            assert sorted(pool.map(claim, range(2))) == [200, 409]


def test_cli_create_upload_export_and_revision_conflict(connected, tmp_path):
    from PIL import Image

    backend, data = connected
    approve(backend, data)
    binary = os.environ.get("FPL_TEST_CLI_BINARY")
    executable = [binary] if binary else [sys.executable, "-m", "future_props_lab.cli"]
    command = [*executable, "--data-dir", str(data)]
    env = {"PATH": "/usr/bin:/bin", "PYTHONPATH": str(ROOT / "sdk/python/src")}

    def call(name, body, *extra):
        return subprocess.run(
            [*command, "call", name, "--input", "-", *extra],
            input=json.dumps(body),
            capture_output=True,
            text=True,
            env=env,
            cwd="/tmp",
            timeout=30,
        )

    created = call("visual.create_project", {"body": {"title": "CLI round trip", "kind": "image"}})
    assert created.returncode == 0, created.stderr
    project = json.loads(created.stdout)
    image = tmp_path / "image.png"
    Image.new("RGB", (16, 16), "blue").save(image)
    uploaded = call("files.upload_file", {"body": {}}, "--file", f"upload={image}")
    assert uploaded.returncode == 0, uploaded.stderr
    asset = json.loads(uploaded.stdout)
    output = tmp_path / "export.zip"
    exported = call(
        "visual.export_project_snapshot", {"project_id": project["id"]}, "--output", str(output)
    )
    assert exported.returncode == 0, exported.stderr
    assert output.read_bytes().startswith(b"PK")
    content = output.read_bytes()
    duplicate = call(
        "visual.export_project_snapshot", {"project_id": project["id"]}, "--output", str(output)
    )
    assert duplicate.returncode == 2 and output.read_bytes() == content
    downloaded = tmp_path / "download.png"
    assert (
        call(
            "files.download_file", {"asset_id": asset["id"]}, "--output", str(downloaded)
        ).returncode
        == 0
    )
    assert downloaded.read_bytes() == image.read_bytes()
    conflict = call(
        "visual.patch_project",
        {"project_id": project["id"], "body": {"title": "bad", "expected_revision": 999}},
    )
    assert conflict.returncode == 4, conflict.stderr
    assert (
        backend.client.get(f"/v1/visual-workshop/projects/{project['id']}").json()["title"]
        == "CLI round trip"
    )


def test_key_does_not_follow_browser_workspace_switch(connected):
    backend, data = connected
    result = approve(backend, data)
    workspace = backend.client.post(
        "/v1/platform/workspaces",
        json={
            "name": "Other workspace",
            "owner_user_id": result["user_id"],
        },
    )
    assert workspace.status_code == 201, workspace.text
    other = workspace.json()["id"]
    assert (
        backend.client.post(
            "/v1/account/workspaces/switch", json={"workspace_id": other}
        ).status_code
        == 200
    )
    project = backend.client.post(
        "/v1/visual-workshop/projects", json={"title": "private", "kind": "image"}
    ).json()
    with desktop_client(data_dir=data) as sdk:
        from future_props_lab import ApiError

        assert (
            sdk._call("GET", "/v1/desktop/agent/capabilities")["workspace_id"]
            == result["workspace_id"]
        )
        with pytest.raises(ApiError) as denied:
            sdk.visual.get_project(project_id=project["id"])
        assert denied.value.status == 404
        with pytest.raises(ApiError) as denied:
            sdk._call(
                "POST",
                "/v1/desktop/ui/open",
                body={"kind": "visual", "resource_id": project["id"]},
                media_type="application/json",
            )
        assert denied.value.status == 404


def test_integration_manifest_registers_exact_existing_operations():
    specification = json.loads((ROOT / "web/src/generated/openapi.json").read_text())
    expected = {
        f"{method.upper()} {path}"
        for path, methods in specification["paths"].items()
        if path.startswith("/v1/integrations/")
        for method in methods
        if method in {"get", "post", "patch", "delete", "put"}
    }
    registered = {item for item in MANIFEST["operations"] if "/v1/integrations/" in item}
    assert registered == expected
    assert not allows_agent("POST", "/v1/integrations/install-command")
