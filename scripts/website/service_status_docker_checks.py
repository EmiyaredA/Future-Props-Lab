"""Real Mac lifecycle observations, narrow Management transport and Gateway status."""

import json
import secrets
from threading import Event, Thread

import httpx

from studio.contracts.gateway.routing import RouteCatalog
from studio.deployment.gateway import render_gateway
from studio.host.deployment.service_observation import ServiceObserver


class StatusFixture:
    def __init__(self, root, repo):
        self.root, self.repo = root, repo
        self.gateway, self.identity, self.ingress, self.worker = [
            secrets.token_urlsafe(48) for _ in range(4)
        ]
        self.local_port, self.public_port, self.native_port = 19102, 19183, 29192
        self.stop = Event()
        self.thread = None
        self.errors = []

    def prepare(self, material, environment, image):
        (self.root / "management").mkdir(mode=0o700)
        material.update(
            {
                "management.toml": b'[storage]\ndatabase_path = "/state/service.db"\n',
                "management-gateway-token": self.gateway.encode(),
                "management-identity-token": self.identity.encode(),
                "management-native-ingress": self.ingress.encode(),
                "management-workers.json": json.dumps({"fixture-status": self.worker}).encode(),
                "management-Caddyfile": render_gateway(
                    RouteCatalog.read(self.repo / "deploy/contracts/ownership.json"),
                    gateway_token=self.gateway,
                    local_origin=f"http://127.0.0.1:{self.local_port}",
                    public_origin="https://admin.example.test",
                    native_tokens={"management": self.ingress},
                    native_port=self.native_port,
                    control=True,
                    audience="management",
                ).encode(),
            }
        )
        credentials = json.loads(material["service-credentials.json"])
        credentials["management"] = self.identity
        material["service-credentials.json"] = json.dumps(credentials).encode()
        material["identity.toml"] += (
            f'\n[management]\nlocal_origin = "http://127.0.0.1:{self.local_port}"\n'
            'public_origin = "https://admin.example.test"\n'
        ).encode()
        environment.update(
            {
                "FPL_MANAGEMENT_IMAGE": image,
                "FPL_MANAGEMENT_STATE": str(self.root / "management"),
                "FPL_MANAGEMENT_LOCAL_PORT": str(self.local_port),
                "FPL_MANAGEMENT_PUBLIC_PORT": str(self.public_port),
                "FPL_MANAGEMENT_NATIVE_PORT": str(self.native_port),
                **{
                    f"FPL_MANAGEMENT_{name}": str(self.root / filename)
                    for name, filename in {
                        "CONFIG": "management.toml",
                        "CADDYFILE": "management-Caddyfile",
                        "GATEWAY_TOKEN": "management-gateway-token",
                        "IDENTITY_TOKEN": "management-identity-token",
                        "NATIVE_INGRESS": "management-native-ingress",
                        "WORKERS": "management-workers.json",
                    }.items()
                },
            }
        )

    def publish(self, compose):
        observer = ServiceObserver(lambda args: compose(*args, timeout_seconds=10).stdout)
        with httpx.Client(trust_env=False, timeout=5) as lane:
            response = lane.post(
                f"http://127.0.0.1:{self.native_port}/management/_native/v1/report",
                headers={"Authorization": "Bearer " + self.worker},
                json={"services": observer.read()},
            )
            assert response.status_code == 200, response.text

    def follow(self, compose):
        self.publish(compose)

        def observe():
            while not self.stop.wait(3):
                try:
                    self.publish(compose)
                except (RuntimeError, httpx.HTTPError, AssertionError) as exc:
                    self.errors.append(type(exc).__name__)

        self.thread = Thread(target=observe, daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=26)
            if self.thread.is_alive():
                self.errors.append("observer_did_not_stop")

    def verify(self):
        assert not self.errors, "Lifecycle observer failed: " + ",".join(self.errors)

    def check(self, client, compose, started, wait, history):
        path = "/v1/automation/services"
        self.publish(compose)
        response = wait(client, path)
        assert "no-store" in response.headers["cache-control"]
        values = {s["service_id"]: s for s in response.json()["services"]}
        assert values["agents"]["phase"] == "running", values["agents"]
        assert values["portal"]["phase"] == "running", values["portal"]
        assert values["visual"]["phase"] == "not_deployed"
        stable = {name: started(name) for name in ("gateway", "identity", "agents", "management")}
        compose("stop", "portal")
        self.publish(compose)
        stopped = wait(
            client,
            path,
            lambda r: (
                r.status_code == 200
                and any(
                    s["service_id"] == "portal" and s["phase"] == "stopped"
                    for s in r.json()["services"]
                )
            ),
        )
        assert (
            "已停止"
            in next(s for s in stopped.json()["services"] if s["service_id"] == "portal")["detail"]
        )
        assert client.get(history).status_code == 200
        assert all(started(name) == stamp for name, stamp in stable.items())
        compose("start", "portal")
        wait(client, "/")
        self.publish(compose)
        wait(
            client,
            path,
            lambda r: (
                r.status_code == 200
                and any(
                    s["service_id"] == "portal" and s["phase"] == "running"
                    for s in r.json()["services"]
                )
            ),
        )
        return (
            "real Mac observations show Portal stop/recovery through Identity delegation "
            "without restarting sibling services"
        )
