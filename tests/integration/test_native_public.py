"""Opt-in hot reload keeps public requests on the public authorization lane."""

import asyncio
import json
from unittest.mock import Mock

import pytest
from scripts.website import development, native_development, native_public
from scripts.website.native_layout import configuration_copy

from studio.contracts.gateway.catalog import SERVICES
from studio.contracts.gateway.routing import Operation, RouteCatalog
from studio.contracts.gateway.web_access import GatewayProfile
from studio.deployment.gateway import render_gateway
from studio.runtime.lifecycle.locking import service_lock


def public_config(tmp_path):
    credentials = tmp_path / "backend/web-access/credentials"
    credentials.mkdir(parents=True)
    for identity, kind in [("a" * 32, "identity"), ("b" * 32, "known_hosts")]:
        path = credentials / f"{identity}.{kind}"
        path.touch(mode=0o600)
    config = tmp_path / "backend/config.toml"
    config.write_text(
        '[remote_web]\norigin="https://studio.example.test"\n'
        'ssh_host="gateway.example.test"\nssh_user="tunnel"\n'
        f'identity_id="{"a" * 32}"\nknown_hosts_id="{"b" * 32}"\n'
        '[management]\npublic_origin="https://studio.example.test"\n'
        '[management_remote]\nssh_host="gateway.example.test"\nssh_user="management"\n'
        f'identity_id="{"a" * 32}"\nknown_hosts_id="{"b" * 32}"\n'
    )
    return config


def test_public_profiles_use_existing_credentials_without_changing_configuration(tmp_path):
    config = public_config(tmp_path)
    before = config.read_bytes()
    tunnels = native_public.configured_tunnels(tmp_path, config)
    assert set(tunnels) == {"gateway"}
    assert tunnels["gateway"].profile.local_port == 28081
    tunnels = native_public.configured_tunnels(tmp_path, config, management=True)
    assert tunnels["management"].profile.origin == "https://studio.example.test"
    assert tunnels["management"].profile.remote_port == 28082
    assert config.read_bytes() == before


def test_public_preflight_rejects_missing_or_insecure_credentials(tmp_path):
    config = public_config(tmp_path)
    identity = tmp_path / f'backend/web-access/credentials/{"a" * 32}.identity'
    identity.chmod(0o644)
    with pytest.raises(ValueError, match="0600"):
        native_public.configured_tunnels(tmp_path, config)
    identity.unlink()
    with pytest.raises(ValueError, match="不可用"):
        native_public.configured_tunnels(tmp_path, config)


def test_public_preflight_rejects_port_collisions(tmp_path):
    config = public_config(tmp_path)
    config.write_text(config.read_text() + "port=28081\n")
    with pytest.raises(ValueError, match="独立"):
        native_public.configured_tunnels(tmp_path, config, management=True)


def test_identity_projection_receives_exact_public_origins_without_modifying_source(tmp_path):
    source = public_config(tmp_path)
    original = source.read_bytes()
    profiles = {
        "gateway": GatewayProfile(origin="https://new-studio.example.test"),
        "management": GatewayProfile(origin="https://new-management.example.test"),
    }
    destination = tmp_path / "projected.toml"
    configuration_copy(source, destination, {}, identity=True, public_profiles=profiles)
    import tomllib

    projected = tomllib.loads(destination.read_text())
    assert projected["remote_web"]["origin"] == profiles["gateway"].origin
    assert projected["management"]["public_origin"] == profiles["management"].origin
    assert projected["management"]["local_origin"] == "http://127.0.0.1:3000"
    assert source.read_bytes() == original


def gateway_config(**options):
    addresses = {unit.id: f"127.0.0.1:{19100 + index}" for index, unit in enumerate(SERVICES)}
    return render_gateway(
        RouteCatalog([Operation("assets", "POST", "/v1/files", "upload")]),
        gateway_token="g" * 40,
        local_origin="http://127.0.0.1:3000",
        public_origin="https://studio.example.test",
        addresses=addresses,
        local_only=True,
        local_port=9001,
        native_tokens={"tools": "n" * 40},
        **options,
    )


def test_public_gateway_keeps_socket_identity_and_routes_only_frontend_to_vite():
    config = gateway_config(public_loopback_port=28081, development_frontend="127.0.0.1:3000")
    local, public = config.split("http://127.0.0.1:28081 {", 1)
    public, native = public.split("http://127.0.0.1:29090 {", 1)
    assert "X-Fpl-Ingress public" not in local
    assert "X-Fpl-Ingress public" in public
    assert "X-Fpl-Ingress local" not in public
    assert '"https://studio.example.test"' in public
    assert "forward_auth " in public
    assert "request_header -X-Fpl-*" in public
    assert "respond @internal 404" in public
    assert public.index("@unknown_api") < public.index("reverse_proxy 127.0.0.1:3000")
    assert "/_apps/portal/*" in public
    assert "header_up -Cookie" in public
    assert "request_header -Cookie" in native
    assert "http://:" not in config


@pytest.mark.parametrize("port", [9001, 29090, 80, 65536, "28081"])
def test_public_gateway_rejects_conflicting_or_invalid_listener(port):
    with pytest.raises(ValueError, match="独立回环"):
        gateway_config(public_loopback_port=port)


@pytest.mark.parametrize("address", ["0.0.0.0:3000", "127.0.0.1:99999", "localhost:3000"])
def test_public_gateway_rejects_non_loopback_frontend(address):
    with pytest.raises(ValueError, match="开发前端"):
        gateway_config(public_loopback_port=28081, development_frontend=address)


def test_launcher_forwards_public_flags_to_native_mode(tmp_path, monkeypatch):
    config = tmp_path / "backend/config.toml"
    config.parent.mkdir()
    config.write_text('[deployment.environment]\nFPL_LOCAL_PORT="3000"\n')
    monkeypatch.setattr(development, "ROOT", tmp_path)
    run = Mock()
    monkeypatch.setattr(native_development, "run", run)
    development.main(["--public", "--public-management"])
    run.assert_called_once_with(tmp_path, public=True, public_management=True)


def test_launcher_rejects_management_without_public():
    with pytest.raises(SystemExit) as error:
        development.main(["--public-management"])
    assert error.value.code == 2


def test_duplicate_start_cannot_silently_change_public_mode(tmp_path):
    directory = tmp_path / ".runtime/native-development"
    (directory / "tools").mkdir(parents=True)
    (directory / "tools/caddy").touch()
    record = directory / "process.json"
    record.write_text('{"pid":12345,"public":false}')
    with service_lock(directory), pytest.raises(RuntimeError, match="新参数"):
        native_development.run(tmp_path, public=True)
    assert json.loads(record.read_text())["pid"] == 12345


class FakeTunnel:
    def __init__(self, *, fail=False):
        self.fail = fail
        self.phase = "off"
        self.closed = False

    async def action(self, _action):
        if self.fail:
            raise ValueError("preflight failure")
        self.phase = "ready"

    def snapshot(self):
        return {"phase": self.phase, "url": "https://studio.example.test", "error": ""}

    async def close(self):
        self.closed = True
        self.phase = "off"


@pytest.mark.asyncio
async def test_partial_tunnel_start_failure_closes_both_tunnels(tmp_path):
    first, second = FakeTunnel(), FakeTunnel(fail=True)
    with pytest.raises(ValueError, match="preflight"):
        await native_public.serve(
            {"gateway": first, "management": second}, tmp_path / "status.json", asyncio.Event()
        )
    assert first.closed and second.closed
    assert all(
        state["phase"] == "off"
        for state in json.loads((tmp_path / "status.json").read_text()).values()
    )


@pytest.mark.asyncio
async def test_cancelled_public_worker_drains_tunnels_and_records_offline(tmp_path):
    tunnel = FakeTunnel()
    status = tmp_path / "status.json"
    task = asyncio.create_task(native_public.serve({"gateway": tunnel}, status, asyncio.Event()))
    for _ in range(100):
        if status.exists():
            break
        await asyncio.sleep(0.001)
    assert json.loads(status.read_text())["gateway"]["phase"] == "ready"
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert tunnel.closed
    assert json.loads(status.read_text())["gateway"]["phase"] == "off"
