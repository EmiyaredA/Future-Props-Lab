"""Exercise real Identity/Gateway containers using only disposable, isolated data."""

import argparse
import io
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fpl_deployment.gateway import render_gateway  # noqa: E402
from fpl_runtime.routing import RouteCatalog  # noqa: E402


def exercise(
    image,
    *,
    local_port,
    public_port,
    thought_image=None,
    assets_image=None,
    browser_check=False,
    gateway_image="caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e",
):
    control = not gateway_image.startswith("caddy@")
    if thought_image and not assets_image:
        raise ValueError("Thought acceptance requires Assets")
    thought_credentials = [secrets.token_urlsafe(48) for _ in range(4)] if thought_image else []

    run_id = secrets.token_hex(5)
    project = "fpl-isolated-identity-" + run_id
    root = ROOT / ".local/service-split" / project
    subprocess.run(["git", "check-ignore", "--quiet", str(root)], cwd=ROOT, check=True)
    root.mkdir(parents=True, mode=0o700)
    (root / "identity").mkdir(mode=0o700)
    (root / "agents").mkdir(mode=0o700)
    (root / "gateway").mkdir(mode=0o700)
    (root / "portal").mkdir(mode=0o700)
    gateway_token = secrets.token_urlsafe(48)
    password = secrets.token_urlsafe(30) + "-Aa9!"
    encryption_key = Fernet.generate_key().decode()
    key = Ed25519PrivateKey.generate()
    material = {
        "identity.toml": (
            '[storage]\ndatabase_path = "/state/service.db"\n'
            "[security]\nsecrets_key = " + json.dumps(encryption_key) + "\n"
            f"[website]\nport = {local_port}\n"
            '[remote_web]\norigin = "https://studio.example.test"\n'
        ).encode(),
        "identity-signing.pem": key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        "gateway-token": gateway_token.encode(),
        "service-credentials.json": json.dumps({"gateway": gateway_token}).encode(),
        "publishers.json": b"{}",
        "workers.json": b"{}",
        "native-ingress": secrets.token_urlsafe(48).encode(),
        "agents-token": secrets.token_urlsafe(48).encode(),
        "identity-public.pem": key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ),
        "Caddyfile": render_gateway(
            RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
            gateway_token=gateway_token,
            local_origin=f"http://127.0.0.1:{local_port}",
            public_origin="https://studio.example.test",
            control=control,
        ).encode(),
    }
    material["agents.toml"] = material["identity.toml"]
    material["gateway.toml"] = material["identity.toml"]
    if thought_image:
        thought_token, assets_token, community_token, upload_token = thought_credentials
        for service in ("thought", "assets"):
            (root / service).mkdir(mode=0o700)
            material[service + ".toml"] = b'[storage]\ndatabase_path = "/state/service.db"\n'
        material["thought-client.json"] = json.dumps({"credential": thought_token}).encode()
        material["assets-client.json"] = json.dumps({"credential": assets_token}).encode()
        material["thought-peer.json"] = json.dumps(
            {"community": community_token, "upload_receipt": upload_token}
        ).encode()
        material["service-credentials.json"] = json.dumps(
            {"gateway": gateway_token, "thought": thought_token, "assets": assets_token}
        ).encode()
    for name, content in material.items():
        path = root / name
        path.write_bytes(content)
        path.chmod(0o600)
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith(("COMPOSE_", "FPL_"))
    }
    environment.update(
        {
            "COMPOSE_DISABLE_ENV_FILE": "true",
            "FPL_IDENTITY_IMAGE": image,
            "FPL_RENDERING_IMAGE": "fpl/rendering:acceptance-unselected",
            "FPL_RENDERING_STATE": str(root / "portal"),
            "FPL_RENDERING_CONFIG": str(root / "identity.toml"),
            "FPL_RENDERING_IDENTITY_CLIENT": str(root / "service-credentials.json"),
            "FPL_ASSETS_IMAGE": "fpl/assets:acceptance-unselected",
            "FPL_ASSETS_STATE": str(root / "portal"),
            "FPL_ASSETS_CONFIG": str(root / "identity.toml"),
            "FPL_ASSETS_IDENTITY_CLIENT": str(root / "service-credentials.json"),
            "FPL_PORTAL_IMAGE": "fpl/portal:acceptance-unselected",
            "FPL_PORTAL_STATE": str(root / "portal"),
            "FPL_PORTAL_CONFIG": str(root / "identity.toml"),
            "FPL_GATEWAY_IMAGE": gateway_image,
            "FPL_GATEWAY_STATE": str(root / "gateway"),
            "FPL_GATEWAY_SETTINGS": str(root / "gateway.toml"),
            "FPL_GATEWAY_IDENTITY_TOKEN": str(root / "gateway-token"),
            "FPL_GATEWAY_PUBLISHERS": str(root / "publishers.json"),
            "FPL_IDENTITY_SERVICE_CREDENTIALS": str(root / "service-credentials.json"),
            "FPL_AGENTS_IMAGE": image,
            "FPL_AGENTS_STATE": str(root / "agents"),
            "FPL_AGENTS_CONFIG": str(root / "agents.toml"),
            "FPL_IDENTITY_PUBLIC_KEY": str(root / "identity-public.pem"),
            "FPL_AGENTS_IDENTITY_TOKEN": str(root / "agents-token"),
            "FPL_AGENTS_NATIVE_INGRESS": str(root / "native-ingress"),
            "FPL_AGENTS_WORKERS": str(root / "workers.json"),
            "FPL_NATIVE_PORT": "19090",
            "FPL_SERVICE_UID": str(os.getuid()),
            "FPL_SERVICE_GID": str(os.getgid()),
            "FPL_IDENTITY_STATE": str(root / "identity"),
            "FPL_IDENTITY_CONFIG": str(root / "identity.toml"),
            "FPL_IDENTITY_SIGNING_KEY": str(root / "identity-signing.pem"),
            "FPL_GATEWAY_TOKEN": str(root / "gateway-token"),
            "FPL_GATEWAY_CONFIG": str(root / "Caddyfile"),
            "FPL_LOCAL_PORT": str(local_port),
            "FPL_PUBLIC_PORT": str(public_port),
        }
    )
    if thought_image:
        environment.update(
            {
                "FPL_THOUGHT_IMAGE": thought_image,
                "FPL_ASSETS_IMAGE": assets_image,
                "FPL_ASSETS_STATE": str(root / "assets"),
                "FPL_ASSETS_CONFIG": str(root / "assets.toml"),
                "FPL_ASSETS_IDENTITY_CLIENT": str(root / "assets-client.json"),
                "FPL_THOUGHT_STATE": str(root / "thought"),
                "FPL_THOUGHT_CONFIG": str(root / "thought.toml"),
                "FPL_THOUGHT_IDENTITY_CLIENT": str(root / "thought-client.json"),
                "FPL_THOUGHT_ASSETS_PEER": str(root / "thought-peer.json"),
            }
        )
    fixture = {
        "services": {
            "agents": {
                "image": image,
                "entrypoint": ["python", "/probe.py"],
                "command": [],
                "user": f"{os.getuid()}:{os.getgid()}",
                "read_only": True,
                "cap_drop": ["ALL"],
                "environment": {"FPL_PROBE_KEY": "/probe-public.pem"},
                "volumes": [
                    f"{ROOT / 'tests/gateway_assertion_probe.py'}:/probe.py:ro",
                    f"{root / 'identity-public.pem'}:/probe-public.pem:ro",
                ],
                "networks": ["private"],
            }
        },
    }
    (root / "protocol-fixture.yaml").write_text(yaml.safe_dump(fixture))
    prefix = [
        "docker",
        "compose",
        "--env-file",
        "/dev/null",
        "--project-name",
        project,
        "--file",
        str(ROOT / "deploy/compose.yaml"),
        "--file",
        str(root / "protocol-fixture.yaml"),
    ]

    if thought_image:
        prefix.extend(["--file", str(ROOT / "deploy/thought.compose.yaml")])

    def compose(*args, input_text=None, checked=True):
        result = subprocess.run(
            [*prefix, *args],
            cwd=ROOT,
            env=environment,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=90,
        )
        log = result.stdout + result.stderr
        for secret in (gateway_token, password, encryption_key, *thought_credentials):
            log = log.replace(secret, "[redacted]")
        with (root / "commands.log").open("a") as output:
            output.write("compose " + " ".join(args) + "\n" + log + "\n")
        if checked and result.returncode:
            raise RuntimeError("Compose command failed: " + " ".join(args) + "\n" + log[-4000:])
        return result

    def started(service):
        container = compose("ps", "--quiet", service).stdout.strip()
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.StartedAt}}", container],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        return result.stdout.strip()

    checks = []
    try:
        compose("config", "--quiet")
        compose("run", "--rm", "--no-deps", "identity", "migrate")
        if control:
            compose("run", "--rm", "--no-deps", "gateway", "migrate")
        compose(
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "identity",
            "create-admin",
            input_text=json.dumps({"username": "isolated-admin", "password": password}),
        )
        extra = ("thought", "assets") if thought_image else ()
        for service in extra:
            compose("run", "--rm", "--no-deps", service, "migrate")
        compose("up", "--detach", "--no-build", "identity", "gateway", "agents", *extra)
        base = f"http://127.0.0.1:{local_port}"
        with httpx.Client(base_url=base, timeout=3, trust_env=False) as client:

            def wait_for(path):
                deadline = time.monotonic() + 30
                last = "no response"
                while time.monotonic() < deadline:
                    try:
                        response = client.get(path)
                        if response.status_code == 200:
                            return response
                        last = f"HTTP {response.status_code}: {response.text[:200]}"
                    except httpx.HTTPError as exc:
                        last = type(exc).__name__ + ": " + str(exc)
                    time.sleep(0.3)
                raise RuntimeError(
                    "Isolated service did not become ready: " + path + " (" + last + ")"
                )

            assert wait_for("/ready").json()["service"] == "gateway"
            assert client.get("/v1/unknown").status_code == 404
            assert client.get("/_internal/v1/authorize").status_code == 404
            assert client.get("/v1/auth/me", headers={"Host": "attacker.test"}).status_code == 403
            assert (
                client.get("/v1/auth/me", headers={"Origin": "https://attacker.test"}).status_code
                == 403
            )
            assert client.get("/v1/agent-workbench/sessions").status_code == 401
            checks.append("unknown routes, Host/Origin and authorization are enforced")
            login = client.post(
                "/v1/auth/login",
                json={"username": "isolated-admin", "password": password},
            )
            assert login.status_code == 200, login.text
            owner = login.json()["user"]["id"]
            assert wait_for("/v1/auth/me").json()["user"]["id"] == owner
            assert login.headers["cache-control"] == "no-store"
            checks.append("browser account login works without Portal")
            unsafe = {"Origin": base, "X-CSRF-Token": client.cookies.get("fpl_csrf", "")}
            if thought_image:
                from thought_docker_checks import verify_thought

                wait_for("/apps/thought-workshop")
                checks.append(
                    verify_thought(client, unsafe, compose, ROOT, base, browser=browser_check)
                )
            profile = client.patch(
                "/v1/account/profile",
                headers=unsafe,
                json={"display_name": "隔离账号", "expected_revision": 0},
            )
            assert profile.status_code == 200, profile.text
            png = io.BytesIO()
            Image.new("RGB", (8, 8), (20, 90, 140)).save(png, format="PNG")
            avatar_bytes = png.getvalue()
            avatar = client.put(
                "/v1/account/profile/avatar",
                headers=unsafe,
                data={"expected_revision": "1"},
                files={"file": ("avatar.png", avatar_bytes, "image/png")},
            )
            assert avatar.status_code == 200, avatar.text
            assert client.get("/v1/account/profile/avatar").content == avatar_bytes
            partial = client.get("/v1/account/profile/avatar", headers={"Range": "bytes=0-7"})
            assert partial.status_code == 206 and partial.content == avatar_bytes[:8]
            conflict_profile = client.patch(
                "/v1/account/profile",
                headers=unsafe,
                json={"display_name": "must not overwrite", "expected_revision": 0},
            )
            assert conflict_profile.status_code == 409
            checks.append("profile CAS, multipart avatar and private Range responses work")
            # This disposable upstream verifies the transport protocol; it is not an Agents service.
            proxied = wait_for("/v1/agent-workbench/sessions").json()
            assert proxied == {
                "owner": owner,
                "local": True,
                "gateway_token_leaked": False,
                "ingress_header_leaked": False,
                "session_cookie_leaked": False,
                "authorization_leaked": False,
            }
            with httpx.Client(
                base_url=f"http://127.0.0.1:{public_port}", trust_env=False, timeout=3
            ) as public:
                public_headers = {
                    "Host": "studio.example.test",
                    "Origin": "https://studio.example.test",
                    "Cookie": "fpl_session=" + client.cookies.get("fpl_session"),
                    "X-Fpl-Ingress": "local",
                    "X-Fpl-Context": "forged",
                    "X-Forwarded-Host": f"127.0.0.1:{local_port}",
                }
                response = public.get("/v1/agent-workbench/sessions", headers=public_headers)
                assert response.status_code == 200, response.text
                assert response.json() == {
                    "owner": owner,
                    "local": False,
                    "gateway_token_leaked": False,
                    "ingress_header_leaked": False,
                    "session_cookie_leaked": False,
                    "authorization_leaked": False,
                }
            checks.append("public ingress cannot forge host authority or identity headers")
            assert client.post("/v1/auth/logout").status_code == 403
            conflict = compose(
                "run", "--rm", "--no-deps", "-T", "identity", "migrate", checked=False
            )
            assert conflict.returncode != 0
            assert "已由另一个实例使用" in conflict.stderr
            checks.append("a second process cannot open the active service data")
            identity_started = started("identity")
            compose("restart", "gateway")
            assert wait_for("/v1/auth/me").json()["user"]["id"] == owner
            assert started("identity") == identity_started
            checks.append("gateway restart preserves the Identity process and session")
            gateway_started = started("gateway")
            compose("up", "--detach", "--no-deps", "--force-recreate", "identity")
            assert wait_for("/v1/auth/me").json()["user"]["id"] == owner
            assert started("gateway") == gateway_started
            assert client.get("/v1/account/profile/avatar").content == avatar_bytes
            assert client.get("/v1/account/profile").json()["display_name"] == "隔离账号"
            checks.append("Identity recreation preserves SQLite and the Gateway process")
            diagnostics = compose(
                "exec",
                "-T",
                "identity",
                "python",
                "-c",
                "import sqlite3; c=sqlite3.connect('file:/state/service.db?mode=ro', uri=True);"
                "assert c.execute('PRAGMA quick_check').fetchone()[0]=='ok';"
                "assert c.execute('PRAGMA journal_mode').fetchone()[0]=='wal';"
                "print('WAL and integrity ok')",
            )
            assert "integrity ok" in diagnostics.stdout
            checks.append("container-owned SQLite uses WAL and passes integrity checks")
            compose("stop", "identity")
            shutil.copytree(root / "identity", root / "identity-backup")
            shutil.move(root / "identity", root / "identity-before-restore")
            shutil.copytree(root / "identity-backup", root / "identity")
            compose("up", "--detach", "--no-deps", "identity")
            assert wait_for("/v1/auth/me").json()["user"]["id"] == owner
            assert client.get("/v1/account/profile/avatar").content == avatar_bytes
            assert client.get("/v1/account/profile").json()["display_name"] == "隔离账号"
            checks.append("offline complete service snapshot restores the original session")
            unsafe = {"Origin": base, "X-CSRF-Token": client.cookies.get("fpl_csrf", "")}
            assert client.post("/v1/auth/logout", headers=unsafe).status_code == 204
            assert client.get("/v1/auth/me").status_code == 401
            checks.append("logout immediately prevents subsequent authenticated requests")
        report = {"status": "passed", "image": image, "checks": checks, "project": project}
        if thought_image:
            report["images"] = {
                "identity": image,
                "gateway": gateway_image,
                "thought": thought_image,
                "assets": assets_image,
            }
            report["browser"] = browser_check
        (root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False))
    finally:
        extra = ("thought", "assets") if thought_image else ()
        compose("logs", "--no-color", "--tail", "50", "gateway", "identity", *extra, checked=False)
        compose("down", "--remove-orphans", checked=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument(
        "--gateway-image",
        default="caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e",
    )
    parser.add_argument("--thought-image")
    parser.add_argument("--assets-image")
    parser.add_argument("--browser-check", action="store_true")
    parser.add_argument("--local-port", type=int, default=19000)
    parser.add_argument("--public-port", type=int, default=19081)
    args = parser.parse_args()
    exercise(
        args.image,
        local_port=args.local_port,
        public_port=args.public_port,
        gateway_image=args.gateway_image,
        thought_image=args.thought_image,
        assets_image=args.assets_image,
        browser_check=args.browser_check,
    )
