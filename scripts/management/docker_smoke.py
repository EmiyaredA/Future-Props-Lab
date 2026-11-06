"""Disposable Identity/Management/Caddy acceptance, without host commands or real data."""

import argparse
import json
import os
import secrets
import subprocess
import time
from pathlib import Path

import httpx
import yaml
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.contracts.gateway.routing import RouteCatalog
from studio.deployment.gateway import render_gateway

ROOT = Path(__file__).resolve().parents[2]


def exercise(
    *, output_root, identity_image, management_image, local_port, public_port, native_port
):
    output_root = output_root.resolve()
    if not output_root.is_relative_to(ROOT / ".local"):
        raise ValueError("隔离验收产物必须位于本工作树的 .local")
    subprocess.run(["git", "check-ignore", "--quiet", str(output_root)], cwd=ROOT, check=True)
    root = output_root / secrets.token_hex(5)
    root.mkdir(parents=True, mode=0o700)
    for name in ("identity", "management"):
        (root / name).mkdir(mode=0o700)
    key = Ed25519PrivateKey.generate()
    management_token, business_token = secrets.token_urlsafe(48), secrets.token_urlsafe(48)
    service_token, ingress_token, worker_token = [secrets.token_urlsafe(48) for _ in range(3)]
    password = secrets.token_urlsafe(25) + "-Aa9!"
    local = f"http://127.0.0.1:{local_port}"
    public = "https://studio.example.test"
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    materials = {
        "identity.toml": (
            '[storage]\ndatabase_path = "/state/service.db"\n'
            "[security]\nsecrets_key = " + json.dumps(Fernet.generate_key().decode()) + "\n"
            '[website]\nport = 23900\n[remote_web]\norigin = "https://studio.example.test"\n'
            "[management]\nlocal_origin = "
            + json.dumps(local)
            + "\npublic_origin = "
            + json.dumps(public)
            + "\n"
        ).encode(),
        "management.toml": b'[storage]\ndatabase_path = "/state/service.db"\n',
        "gateway-token": business_token.encode(),
        "management-gateway-token": management_token.encode(),
        "identity-token": service_token.encode(),
        "native-ingress": ingress_token.encode(),
        "workers.json": json.dumps({"mac": worker_token}).encode(),
        "service-credentials.json": json.dumps({"management": service_token}).encode(),
        "identity-signing.pem": key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        "identity-public.pem": key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ),
        "Caddyfile": render_gateway(
            catalog,
            gateway_token=management_token,
            local_origin=local,
            public_origin=public,
            native_tokens={"management": ingress_token},
            native_port=native_port,
            control=True,
            audience="management",
        ).encode(),
    }
    for name, data in materials.items():
        path = root / name
        path.write_bytes(data)
        path.chmod(0o600)

    def mount(name, target, *, readonly=True):
        return {
            "type": "bind",
            "source": str(root / name),
            "target": target,
            "read_only": readonly,
            "bind": {"create_host_path": False},
        }

    def service(image):
        return {
            "image": image,
            "user": f"{os.getuid()}:{os.getgid()}",
            "read_only": True,
            "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"],
            "init": True,
            "tmpfs": ["/tmp:mode=1777,size=64m"],
            "networks": ["private"],
            "healthcheck": {
                "test": [
                    "CMD",
                    "python",
                    "-c",
                    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ready',timeout=2)",
                ],
                "interval": "2s",
                "timeout": "3s",
                "retries": 20,
            },
        }

    identity = service(identity_image)
    identity["volumes"] = [
        mount("identity", "/state", readonly=False),
        mount("identity.toml", "/run/fpl/config.toml"),
        *[
            mount(name, "/run/fpl/" + name)
            for name in (
                "gateway-token",
                "management-gateway-token",
                "identity-signing.pem",
                "service-credentials.json",
            )
        ],
    ]
    management = service(management_image)
    management["networks"] = ["private", "ingress"]
    management["volumes"] = [
        mount("management", "/state", readonly=False),
        mount("management.toml", "/run/fpl/config.toml"),
        mount("Caddyfile", "/etc/caddy/Caddyfile"),
        *[
            mount(name, "/run/fpl/" + name)
            for name in ("identity-public.pem", "identity-token", "native-ingress", "workers.json")
        ],
    ]
    management["ports"] = [
        f"127.0.0.1:{local_port}:9000",
        f"127.0.0.1:{public_port}:28081",
        f"127.0.0.1:{native_port}:29090",
    ]
    management["depends_on"] = {"identity": {"condition": "service_healthy"}}
    management["environment"] = {
        "XDG_CONFIG_HOME": "/tmp/caddy-config",
        "XDG_DATA_HOME": "/tmp/caddy-data",
    }
    # This deterministic stand-in has no FPL database or personal resources.
    business = service(management_image)
    business.update(
        entrypoint=["python", "-m", "http.server", "8080"],
        command=[],
        healthcheck={"disable": True},
    )
    compose = {
        "services": {"identity": identity, "management": management, "business": business},
        "networks": {"private": {"internal": True}, "ingress": {}},
    }
    path = root / "compose.yaml"
    path.write_text(yaml.safe_dump(compose, sort_keys=False))
    path.chmod(0o600)
    command = [
        "docker",
        "compose",
        "--env-file",
        "/dev/null",
        "--project-name",
        "fpl-management-test-" + root.name,
        "--file",
        str(path),
    ]

    def run(arguments, *, input=None):
        result = subprocess.run(
            [*command, *arguments], input=input, capture_output=True, text=True, timeout=180
        )
        if result.returncode:
            raise RuntimeError(
                "隔离容器步骤失败：" + " ".join(arguments[:3]) + "\n" + result.stderr[-3000:]
            )
        return result.stdout

    try:
        run(["run", "--rm", "--no-deps", "identity", "migrate"])
        run(["run", "--rm", "--no-deps", "management", "migrate"])
        run(
            ["run", "--rm", "--no-deps", "identity", "create-admin"],
            input=json.dumps(
                {"username": "isolated-admin", "display_name": "验收管理员", "password": password}
            ),
        )
        run(["up", "--detach"])
        with httpx.Client(
            base_url=local, trust_env=False, timeout=10, headers={"Origin": local}
        ) as client:
            for _ in range(90):
                try:
                    if client.get("/ready").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError("隔离管理入口未就绪")
            login = client.post(
                "/management/v1/auth/login",
                json={"username": "isolated-admin", "password": password},
            )
            assert login.status_code == 200, login.text
            client.headers["X-CSRF-Token"] = client.cookies["fpl_management_csrf"]
            assert (
                "fpl_management_session" in client.cookies and "fpl_session" not in client.cookies
            )
            assert client.get("/v1/platform/accounts").status_code == 200
            assert client.get("/management/v1/platform/accounts").status_code == 200
            assert client.get("/management/build.json").json()["service"] == "management"
            assert client.get("/management/v1/unregistered").status_code == 404
            assert client.get("/v1/automation/access").status_code == 404
            page = client.get("/management/access")
            assert page.status_code == 200 and "/_apps/management/" in page.text
            assert client.get("/_native/v1/claim").status_code == 404
            run(["stop", "business"])
            assert client.get("/v1/platform/accounts").status_code == 200
            assert client.get("/v1/management/runtime").json()["local_browser"] is True
            accepted = client.post(
                "/v1/management/application/actions",
                json={"action": "start", "request_id": __import__("uuid").uuid4().hex},
            )
            assert accepted.status_code == 202, accepted.text
            with httpx.Client(
                base_url=f"http://127.0.0.1:{public_port}",
                trust_env=False,
                headers={
                    "Host": "studio.example.test",
                    "Origin": public,
                    "X-Fpl-Ingress": "local",
                },
            ) as remote:
                assert remote.get("/v1/platform/accounts").status_code == 404
                login = remote.post(
                    "/management/v1/auth/login",
                    json={"username": "isolated-admin", "password": password},
                )
                assert login.status_code == 200, login.text
                cookies = login.headers.get_list("set-cookie")
                assert len(cookies) == 2 and all(
                    "path=/management" in value.lower() and "; secure" in value.lower()
                    for value in cookies
                )
                assert any(
                    value.startswith("fpl_management_session=") and "httponly" in value.lower()
                    for value in cookies
                )
                # Model the Secure cookies a browser would send through the HTTPS edge.
                remote.headers["Cookie"] = "; ".join(
                    f"{name}={value}" for name, value in remote.cookies.items()
                )
                assert remote.get("/management/v1/platform/accounts").status_code == 200
                assert (
                    remote.get("/management/v1/management/runtime").json()["local_browser"] is False
                )
                denied = remote.post(
                    "/management/v1/management/application/actions",
                    json={"action": "stop", "request_id": __import__("uuid").uuid4().hex},
                )
                assert denied.status_code == 403
                remote.headers["X-CSRF-Token"] = remote.cookies["fpl_management_csrf"]
                denied = remote.post(
                    "/management/v1/management/application/actions",
                    json={"action": "stop", "request_id": __import__("uuid").uuid4().hex},
                )
                assert denied.status_code == 403, denied.text
                assert remote.get("/management/v1/management/application/logs").status_code == 403
                assert remote.get("/management/_native/v1/claim").status_code == 404
                logout = remote.post("/management/v1/auth/logout")
                assert logout.status_code == 204
                assert all(
                    "path=/management" in value.lower()
                    for value in logout.headers.get_list("set-cookie")
                )
            native = f"http://127.0.0.1:{native_port}/management/_native/v1"
            with httpx.Client(
                trust_env=False, headers={"Authorization": "Bearer " + worker_token}
            ) as worker:
                claim = worker.post(native + "/claim", json={"wait_seconds": 0})
                assert claim.status_code == 200, claim.text
                lease = claim.json()["lease"]
                assert lease["job_id"] == accepted.json()["id"]
                assert worker.post(native + "/authorize", json={"lease": lease}).status_code == 200
                for _ in range(2):
                    assert (
                        worker.post(
                            native + "/receipt",
                            json={
                                "lease": lease,
                                "outcome": {"status": "completed", "result": {"phase": "running"}},
                            },
                        ).status_code
                        == 200
                    )
            run(["restart", "management"])
            for _ in range(60):
                try:
                    response = client.get("/v1/management/jobs/" + accepted.json()["id"])
                    if response.status_code == 200:
                        assert response.json()["status"] == "completed"
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError("管理重启后回执未恢复")
        result = {
            "isolated": True,
            "business_stopped_management_available": True,
            "governance_available": True,
            "public_host_actions_denied": True,
            "separate_session_cookie": True,
            "native_receipt_idempotent": True,
            "receipt_survives_management_restart": True,
            "independent_web": True,
        }
        (root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"result": str(root / "result.json"), **result}))
    except BaseException:
        logs = subprocess.run(
            [*command, "logs", "--no-color", "--tail", "80"], capture_output=True, text=True
        )
        (root / "container-diagnostics.log").write_text(logs.stdout + logs.stderr)
        raise
    finally:
        subprocess.run(
            [*command, "down", "--remove-orphans"], capture_output=True, text=True, timeout=60
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--identity-image", required=True)
    parser.add_argument("--management-image", required=True)
    parser.add_argument("--local-port", type=int, required=True)
    parser.add_argument("--public-port", type=int, required=True)
    parser.add_argument("--native-port", type=int, required=True)
    exercise(**vars(parser.parse_args()))
