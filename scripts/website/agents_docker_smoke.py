"""Real workbench containers plus an outbound native collector; synthetic data only."""

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fpl_deployment.gateway import render_gateway  # noqa: E402
from fpl_runtime.routing import RouteCatalog  # noqa: E402


def exercise(
    identity_image,
    agents_image,
    *,
    local_port=19100,
    public_port=19181,
    native_port=29090,
    browser_check=False,
    portal_image=None,
    assets_image=None,
    rendering_image=None,
    management_image=None,
    gateway_image="caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e",
):
    project = "fpl-isolated-agents-" + secrets.token_hex(5)
    root = ROOT / ".local/service-split" / project
    subprocess.run(["git", "check-ignore", "--quiet", str(root)], check=True, cwd=ROOT)
    root.mkdir(mode=0o700)
    control = not gateway_image.startswith("caddy@")
    for name in ("identity", "agents", "gateway", "portal", "assets", "rendering", "native"):
        (root / name).mkdir(mode=0o700)
    gateway_token, service_token, lane_token, worker_token = [
        secrets.token_urlsafe(48) for _ in range(4)
    ]
    assets_token = secrets.token_urlsafe(48)
    rendering_token = secrets.token_urlsafe(48)
    gateway_service_token = secrets.token_urlsafe(48)
    password = secrets.token_urlsafe(32) + "-Aa9!"
    key = Ed25519PrivateKey.generate()
    origin = f"http://127.0.0.1:{local_port}"
    native_base = f"http://127.0.0.1:{native_port}"
    config = (
        '[storage]\ndatabase_path = "/state/service.db"\n[security]\nsecrets_key = '
        + json.dumps(Fernet.generate_key().decode())
        + f'\n[website]\nport = {local_port}\n[remote_web]\norigin = "https://studio.example.test"\n'
    )
    material = {
        "identity.toml": config.encode(),
        "agents.toml": config.encode(),
        "rendering.toml": b'[storage]\ndatabase_path = "/state/service.db"\n',
        "rendering-client.json": json.dumps({"credential": rendering_token}).encode(),
        "assets.toml": b'[storage]\ndatabase_path = "/state/service.db"\n',
        "assets-client.json": json.dumps({"credential": assets_token}).encode(),
        "gateway-identity-token": gateway_service_token.encode(),
        "portal.toml": b'[storage]\ndatabase_path = "/state/service.db"\n',
        "identity-signing.pem": key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        "identity-public.pem": key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ),
        "gateway-token": gateway_token.encode(),
        "identity-token": service_token.encode(),
        "native-ingress": lane_token.encode(),
        "workers.json": json.dumps({"fixture-collector": worker_token}).encode(),
        "service-credentials.json": json.dumps(
            {
                "agents": service_token,
                "gateway": gateway_service_token,
                "assets": assets_token,
                "rendering": rendering_token,
            }
        ).encode(),
        "publishers.json": b"{}",
        "connection.json": json.dumps(
            {
                "base_url": native_base + "/agents",
                "credential": worker_token,
            }
        ).encode(),
        "Caddyfile": render_gateway(
            RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
            gateway_token=gateway_token,
            local_origin=origin,
            public_origin="https://studio.example.test",
            native_tokens={"agents": lane_token},
            native_port=native_port,
            control=control,
        ).encode(),
    }
    material["gateway.toml"] = material["agents.toml"]
    records = [
        {
            "type": "session_meta",
            "payload": {
                "id": "docker-native-one",
                "cwd": "/fixture",
                "source": "cli",
                "originator": "codex_cli_rs",
            },
        },
        {
            "type": "response_item",
            "payload": {
                "id": "first",
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "isolated original"}],
            },
        },
    ]
    original = "".join(json.dumps(row) + "\n" for row in records).encode()
    native_file = root / "native/rollout-isolated.jsonl"
    native_file.write_bytes(original)
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith(("FPL_", "COMPOSE_"))
    }
    environment.update(
        {
            "COMPOSE_DISABLE_ENV_FILE": "true",
            "FPL_SERVICE_UID": str(os.getuid()),
            "FPL_SERVICE_GID": str(os.getgid()),
            "FPL_IDENTITY_IMAGE": identity_image,
            "FPL_RENDERING_IMAGE": rendering_image or "fpl/rendering:acceptance-unselected",
            "FPL_RENDERING_STATE": str(root / "rendering"),
            "FPL_RENDERING_CONFIG": str(root / "rendering.toml"),
            "FPL_RENDERING_IDENTITY_CLIENT": str(root / "rendering-client.json"),
            "FPL_ASSETS_IMAGE": assets_image or "fpl/assets:acceptance-unselected",
            "FPL_ASSETS_STATE": str(root / "assets"),
            "FPL_ASSETS_CONFIG": str(root / "assets.toml"),
            "FPL_ASSETS_IDENTITY_CLIENT": str(root / "assets-client.json"),
            "FPL_PORTAL_IMAGE": portal_image or "fpl/portal:acceptance-unselected",
            "FPL_PORTAL_STATE": str(root / "portal"),
            "FPL_PORTAL_CONFIG": str(root / "portal.toml"),
            "FPL_GATEWAY_IMAGE": gateway_image,
            "FPL_GATEWAY_STATE": str(root / "gateway"),
            "FPL_GATEWAY_SETTINGS": str(root / "gateway.toml"),
            "FPL_GATEWAY_IDENTITY_TOKEN": str(root / "gateway-identity-token"),
            "FPL_GATEWAY_PUBLISHERS": str(root / "publishers.json"),
            "FPL_AGENTS_IMAGE": agents_image,
            "FPL_IDENTITY_STATE": str(root / "identity"),
            "FPL_AGENTS_STATE": str(root / "agents"),
            "FPL_IDENTITY_CONFIG": str(root / "identity.toml"),
            "FPL_AGENTS_CONFIG": str(root / "agents.toml"),
            "FPL_IDENTITY_SIGNING_KEY": str(root / "identity-signing.pem"),
            "FPL_IDENTITY_PUBLIC_KEY": str(root / "identity-public.pem"),
            "FPL_GATEWAY_TOKEN": str(root / "gateway-token"),
            "FPL_IDENTITY_SERVICE_CREDENTIALS": str(root / "service-credentials.json"),
            "FPL_AGENTS_IDENTITY_TOKEN": str(root / "identity-token"),
            "FPL_AGENTS_NATIVE_INGRESS": str(root / "native-ingress"),
            "FPL_AGENTS_WORKERS": str(root / "workers.json"),
            "FPL_GATEWAY_CONFIG": str(root / "Caddyfile"),
            "FPL_LOCAL_PORT": str(local_port),
            "FPL_PUBLIC_PORT": str(public_port),
            "FPL_NATIVE_PORT": str(native_port),
        }
    )
    status_fixture = None
    if management_image:
        if not control or not portal_image:
            raise ValueError("Service status acceptance requires Gateway control and Portal")
        from service_status_docker_checks import StatusFixture

        status_fixture = StatusFixture(root, ROOT)
        status_fixture.prepare(material, environment, management_image)
    for name, content in material.items():
        path = root / name
        path.write_bytes(content)
        path.chmod(0o600)
    prefix = [
        "docker",
        "compose",
        "--env-file",
        "/dev/null",
        "--project-name",
        project,
        "--file",
        str(ROOT / "deploy/compose.yaml"),
    ]
    if management_image:
        prefix.extend(["--file", str(ROOT / "deploy/management.compose.yaml")])

    def compose(*args, input_text=None, check=True, timeout_seconds=120):
        result = subprocess.run(
            [*prefix, *args],
            env=environment,
            cwd=ROOT,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        output = result.stdout + result.stderr
        for secret in (
            gateway_token,
            service_token,
            lane_token,
            worker_token,
            password,
            assets_token,
            rendering_token,
            gateway_service_token,
        ):
            output = output.replace(secret, "[redacted]")
        with (root / "commands.log").open("a") as log:
            log.write("compose " + " ".join(args) + "\n" + output + "\n")
        if check and result.returncode:
            raise RuntimeError("Compose failed: " + " ".join(args) + "\n" + output[-5000:])
        return result

    def started(service):
        container = compose("ps", "--quiet", service).stdout.strip()
        return subprocess.check_output(
            ["docker", "inspect", "--format", "{{.State.StartedAt}}", container],
            text=True,
        ).strip()

    def wait(client, path, predicate=lambda response: response.status_code == 200):
        deadline = time.monotonic() + 40
        last = "no response"
        while time.monotonic() < deadline:
            try:
                response = client.get(path)
                last = f"{response.status_code}: {response.text[:300]}"
                if predicate(response):
                    return response
            except httpx.HTTPError as exc:
                last = type(exc).__name__
            time.sleep(0.2)
        raise RuntimeError("Wait failed: " + path + " (" + last + ")")

    collector = None
    collector_log = (root / "collector.log").open("w")
    checks = []
    try:
        compose("config", "--quiet")
        for service in ("identity", "agents", "gateway") if control else ("identity", "agents"):
            compose("run", "--rm", "--no-deps", service, "migrate")
        compose(
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "identity",
            "create-admin",
            input_text=json.dumps({"username": "isolated-admin", "password": password}),
        )
        if rendering_image:
            compose("run", "--rm", "--no-deps", "rendering", "migrate")
        if assets_image:
            compose("run", "--rm", "--no-deps", "assets", "migrate")
        if portal_image:
            compose("run", "--rm", "--no-deps", "portal", "migrate")
        if management_image:
            compose("run", "--rm", "--no-deps", "management", "migrate")
        compose(
            "up",
            "--detach",
            "--no-build",
            "identity",
            "agents",
            "gateway",
            *(("portal",) if portal_image else ()),
            *(("assets",) if assets_image else ()),
            *(("rendering",) if rendering_image else ()),
            *(("management",) if management_image else ()),
        )
        collector = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "fpl_host",
                "collect",
                "--connection",
                str(root / "connection.json"),
                "--state-root",
                str(root / "collector"),
            ],
            cwd=ROOT,
            env={**environment, "PYTHONPATH": str(ROOT / "backend")},
            stdout=collector_log,
            stderr=subprocess.STDOUT,
        )
        with httpx.Client(base_url=origin, trust_env=False, timeout=45) as client:
            wait(client, "/ready")
            login = client.post(
                "/v1/auth/login",
                json={
                    "username": "isolated-admin",
                    "password": password,
                },
            )
            assert login.status_code == 200, login.text
            owner = login.json()["user"]["id"]
            unsafe = {"Origin": origin, "X-CSRF-Token": client.cookies.get("fpl_csrf", "")}
            assert wait(client, "/v1/agent-workbench/sources").json() == []
            for path in ("/_native/v1/claim", "/agents/_native/v1/claim"):
                assert client.post(path, json={}).status_code == 404
            with httpx.Client(base_url=native_base, trust_env=False, timeout=3) as lane:
                assert lane.post("/agents/_native/v1/claim", json={}).status_code == 403
                response = lane.post(
                    "/agents/_native/v1/claim",
                    headers={"Authorization": "Bearer " + worker_token, "Origin": origin},
                    json={},
                )
                assert response.status_code == 403
            if control:
                assert client.get("/v1/automation/runtime").json() == {"local_browser": True}
            source_body = {
                "agent_id": "codex",
                "label": "Isolated native source",
                "root": str(root / "native"),
            }
            with httpx.Client(
                base_url=f"http://127.0.0.1:{public_port}", trust_env=False, timeout=3
            ) as public:
                response = public.post(
                    "/v1/agent-workbench/sources",
                    headers={
                        "Host": "studio.example.test",
                        "Origin": "https://studio.example.test",
                        "Cookie": "fpl_session="
                        + client.cookies.get("fpl_session")
                        + "; fpl_csrf="
                        + client.cookies.get("fpl_csrf"),
                        "X-CSRF-Token": client.cookies.get("fpl_csrf"),
                        "X-Fpl-Ingress": "local",
                        "X-Fpl-Context": "forged",
                        "X-Fpl-Native-Ingress": lane_token,
                    },
                    json=source_body,
                )
                assert response.status_code == 403, response.text
            checks.append("browser/public lanes cannot access or forge native host authority")
            response = client.post(
                "/v1/agent-workbench/sources",
                headers=unsafe,
                json=source_body,
            )
            assert response.status_code == 201, response.text
            source = response.json()
            path = "/v1/agent-workbench/sessions"
            response = wait(
                client, path, lambda r: r.status_code == 200 and len(r.json()["items"]) == 1
            )
            session_id = response.json()["items"][0]["id"]
            history = f"{path}/{session_id}/history"
            assert len(client.get(history).json()["items"]) == 1
            assert native_file.read_bytes() == original
            checks.append(
                "actual Agents container indexes a synthetic native session through the Mac worker"
            )
            identity_started, gateway_started = started("identity"), started("gateway")
            compose("up", "--detach", "--no-deps", "--force-recreate", "agents")
            assert wait(client, history).json()["items"][0]["text"] == "isolated original"
            assert started("identity") == identity_started and started("gateway") == gateway_started
            addition = (
                json.dumps(
                    {
                        "type": "response_item",
                        "payload": {
                            "id": "second",
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {"type": "output_text", "text": "after service replacement"}
                            ],
                        },
                    }
                )
                + "\n"
            )
            with native_file.open("a") as stream:
                stream.write(addition)
            wait(client, history, lambda r: r.status_code == 200 and len(r.json()["items"]) == 2)
            assert native_file.read_bytes() == original + addition.encode()
            checks.append(
                "independent Agents replacement preserves data, Identity, Gateway and native follow"
            )
            if status_fixture:
                checks.append(status_fixture.check(client, compose, started, wait, history))
            if assets_image:
                from assets_docker_checks import exercise_assets

                checks.append(
                    exercise_assets(
                        root=root,
                        repo=ROOT,
                        client=client,
                        unsafe=unsafe,
                        compose=compose,
                        started=started,
                        wait=wait,
                        browser_check=browser_check,
                        password=password,
                    )
                )
            if rendering_image:
                from rendering_docker_checks import exercise_rendering

                checks.append(
                    exercise_rendering(
                        root=root,
                        client=client,
                        unsafe=unsafe,
                        compose=compose,
                        started=started,
                        wait=wait,
                    )
                )
            if portal_image:
                wait(client, "/")
                if status_fixture:
                    status_fixture.follow(compose)
                stable = {
                    service: started(service)
                    for service in (
                        "identity",
                        "agents",
                        "gateway",
                        *(("assets",) if assets_image else ()),
                        *(("rendering",) if rendering_image else ()),
                    )
                }
                if browser_check:
                    result = subprocess.run(
                        ["node", str(ROOT / "web/scripts/portal-service-browser-smoke.mjs")],
                        cwd=ROOT,
                        input=json.dumps(
                            {
                                "origin": origin + "/",
                                "username": "isolated-admin",
                                "password": password,
                                "output": str(root / "portal-browser"),
                                "repo": str(ROOT),
                                "serviceStatus": bool(status_fixture),
                            }
                        ),
                        capture_output=True,
                        text=True,
                        timeout=180,
                    )
                    if result.returncode:
                        raise RuntimeError(
                            "Portal browser acceptance failed: " + result.stdout + result.stderr
                        )
                compose("up", "--detach", "--no-deps", "--force-recreate", "portal")
                wait(client, "/")
                compose("stop", "portal")
                assert client.get("/").status_code == 502
                assert all(started(service) == stamp for service, stamp in stable.items())
                assert client.get(history).status_code == 200
                if assets_image:
                    assert client.get("/v1/files").status_code == 200
                checks.append(
                    "Portal browser, independent replacement and stop preserve Agents and Identity"
                )
            with httpx.Client(base_url=origin, trust_env=False, timeout=3) as fresh:
                response = fresh.post(
                    "/v1/auth/login",
                    json={
                        "username": "isolated-admin",
                        "password": password,
                    },
                )
                assert response.status_code == 200
                assert fresh.get("/v1/auth/me").json()["user"]["id"] == owner
                assert fresh.get(path).json()["items"][0]["id"] == session_id
                if assets_image:
                    assert fresh.get("/v1/files").status_code == 200
            checks.append("fresh browser login and workbench reads need no Portal process")
            if browser_check:
                page = client.get("/agents")
                assert page.status_code == 200 and "text/html" in page.headers["content-type"], (
                    page.text
                )
                old_page = client.get("/apps/agent-workbench/sessions/" + session_id)
                assert (
                    old_page.status_code == 308
                    and old_page.headers["location"] == "/agents/sessions/" + session_id
                ), (old_page.status_code, old_page.headers.get("location"))
                stale = client.post(
                    "/v1/agent-workbench/sources",
                    headers={
                        **unsafe,
                        "X-Application-Id": "agents",
                        "X-Application-Build": "old",
                    },
                    json={},
                )
                assert (
                    stale.status_code == 409
                    and stale.json()["code"] == "application_update_required"
                ), stale.text
                result = subprocess.run(
                    [
                        "node",
                        str(ROOT / "web/scripts/agent-service-browser-smoke.mjs"),
                    ],
                    cwd=ROOT,
                    input=json.dumps(
                        {
                            "origin": origin + "/",
                            "username": "isolated-admin",
                            "password": password,
                            "output": str(root / "browser"),
                            "repo": str(ROOT),
                        }
                    ),
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode:
                    raise RuntimeError(
                        "Browser acceptance failed: " + result.stdout + result.stderr
                    )
                checks.append(
                    "independent browser login, version fencing and responsive themes work "
                    "without Portal"
                )
            paused = client.patch(
                f"/v1/agent-workbench/sources/{source['id']}",
                headers=unsafe,
                json={"expected_revision": source["revision"], "enabled": False},
            )
            assert paused.status_code == 200, paused.text
            assert client.post("/v1/auth/logout", headers=unsafe).status_code == 204
            assert client.get(history).status_code == 401
            checks.append("source pause and browser logout revoke further authorized work")
            diagnostics = compose(
                "exec",
                "-T",
                "agents",
                "python",
                "-c",
                "import sqlite3; c=sqlite3.connect('file:/state/service.db?mode=ro',uri=True);"
                "assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';"
                "assert c.execute('PRAGMA foreign_key_check').fetchall()==[];"
                "tables={r[0] for r in c.execute("
                "\"SELECT name FROM sqlite_master WHERE type='table'\")};"
                "assert 'users' not in tables and 'visual_assets' not in tables;print('isolated')",
            )
            assert "isolated" in diagnostics.stdout
            checks.append("Agents owns only its database and passes SQLite integrity checks")
            gateway_logs = compose("logs", "--no-color", "gateway").stdout
            assert "X-Fpl-Context" not in gateway_logs
            assert "eyJhbGciOi" not in gateway_logs
            checks.append("Gateway runtime errors omit request headers and identity assertions")
        report = {
            "status": "passed",
            "project": project,
            "identity": identity_image,
            "agents": agents_image,
            "checks": checks,
        }
        (root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False))
    finally:
        if status_fixture:
            status_fixture.close()
        if collector is not None:
            collector.terminate()
            try:
                collector.wait(timeout=10)
            except subprocess.TimeoutExpired:
                collector.kill()
                collector.wait(timeout=5)
        collector_log.close()
        compose(
            "logs",
            "--no-color",
            "--tail",
            "50",
            "gateway",
            "identity",
            "agents",
            "portal",
            "assets",
            "rendering",
            check=False,
        )
        compose("down", "--remove-orphans", check=False)
        if status_fixture:
            status_fixture.verify()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-image", required=True)
    parser.add_argument("--agents-image", required=True)
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--portal-image")
    parser.add_argument("--assets-image")
    parser.add_argument("--rendering-image")
    parser.add_argument("--management-image")
    parser.add_argument(
        "--gateway-image",
        default="caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e",
    )
    parser.add_argument("--native-port", type=int, default=29090)
    args = parser.parse_args()
    exercise(
        args.identity_image,
        args.agents_image,
        native_port=args.native_port,
        gateway_image=args.gateway_image,
        browser_check=args.browser,
        portal_image=args.portal_image,
        assets_image=args.assets_image,
        rendering_image=args.rendering_image,
        management_image=args.management_image,
    )
