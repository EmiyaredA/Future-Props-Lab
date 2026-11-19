"""Native startup adapts configuration, never data or request authorization."""

import argparse
import json
from pathlib import Path

import httpx
import pytest
from scripts.website.native_layout import configuration_copy, interpolate, mapped

from studio.assembly.independent.runtime_options import add_runtime_options, parse_runtime_arguments
from studio.contracts.gateway.routing import Operation, RouteCatalog
from studio.deployment.gateway import render_gateway
from studio.runtime.http.service_transport import LocalServiceTransport


@pytest.mark.asyncio
async def test_native_transport_routes_streams_without_changing_signed_paths_or_headers():
    observed = []

    async def receive(request):
        observed.append((str(request.url), dict(request.headers), await request.aread()))
        return httpx.Response(200, content=b"original-result")

    transport = LocalServiceTransport(
        {"assets": "127.0.0.1:19118"}, transport=httpx.MockTransport(receive)
    )
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.post(
            "http://assets:8080/_internal/files?revision=3",
            headers={"X-Fpl-Context": "existing-assertion"},
            content=b"original-body",
        )
        assert str(response.request.url) == "http://assets:8080/_internal/files?revision=3"
        assert response.content == b"original-result"
        await client.get("https://provider.example/result")
    assert observed[0][0] == "http://127.0.0.1:19118/_internal/files?revision=3"
    assert observed[0][1]["host"] == "assets:8080"
    assert observed[0][1]["x-fpl-context"] == "existing-assertion"
    assert observed[0][2] == b"original-body"
    assert observed[1][0] == "https://provider.example/result"


@pytest.mark.parametrize(
    "address", ["0.0.0.0:19100", "localhost:19100", "127.0.0.1:99999", "10.0.0.1:19100"]
)
def test_native_transport_refuses_non_loopback_and_invalid_ports(address):
    with pytest.raises(ValueError):
        LocalServiceTransport({"assets": address})


@pytest.mark.asyncio
async def test_native_transport_rejects_protocol_changes_for_registered_services():
    transport = LocalServiceTransport({"assets": "127.0.0.1:19118"})
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(httpx.ConnectError):
            await client.get("https://assets:8080/private")


def test_runtime_layout_maps_cli_defaults_and_explicit_child_resources(tmp_path, monkeypatch):
    layout = tmp_path / "layout.json"
    layout.write_text(
        json.dumps(
            {
                "paths": {
                    "/state": str(tmp_path / "owned"),
                    "/app": str(tmp_path / "source"),
                    "/app/web": str(tmp_path / "installed"),
                },
                "addresses": {"assets": "127.0.0.1:19118"},
            }
        )
    )
    layout.chmod(0o600)
    parser = argparse.ArgumentParser()
    add_runtime_options(parser)
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    monkeypatch.setattr(
        "sys.argv", ["service", "--runtime-layout", str(layout), "--host", "127.0.0.1"]
    )
    options = parse_runtime_arguments(parser)
    assert options.state_root == tmp_path / "owned"
    assert options.web_root == tmp_path / "installed"
    assert options.runtime.path("/app/web/build.json") == tmp_path / "installed/build.json"
    assert options.runtime.path("/app/backend/a.py") == tmp_path / "source/backend/a.py"
    assert options.host == "127.0.0.1"
    layout.chmod(0o644)
    with pytest.raises(ValueError, match="独占"):
        parse_runtime_arguments(parser)


def test_configuration_projection_keeps_original_bytes_and_encryption_key(tmp_path):
    original = tmp_path / "original.toml"
    original.write_text(
        '[storage]\ndatabase_path="/state/service.db"\n[security]\nsecrets_key="existing-test-key"\n[website]\nport=3000\n'
    )
    before = original.read_bytes()
    projected = tmp_path / "runtime/config.toml"
    configuration_copy(original, projected, {"/state": str(tmp_path / "owned")})
    assert original.read_bytes() == before
    assert "existing-test-key" in projected.read_text()
    assert str(tmp_path / "owned/service.db") in projected.read_text()
    assert projected.stat().st_mode & 0o777 == 0o600
    assert not (tmp_path / "owned/service.db").exists()


def test_local_gateway_keeps_authorization_and_exposes_only_loopback():
    from studio.contracts.gateway.catalog import SERVICES

    addresses = {unit.id: f"127.0.0.1:{19100 + index}" for index, unit in enumerate(SERVICES)}
    catalog = RouteCatalog([Operation("assets", "POST", "/v1/files", "upload")])
    config = render_gateway(
        catalog,
        gateway_token="g" * 40,
        local_origin="http://127.0.0.1:3000",
        public_origin="https://unused.example",
        addresses=addresses,
        local_only=True,
        local_port=9001,
        native_tokens={"tools": "n" * 40},
    )
    assert "http://127.0.0.1:9001 {" in config
    assert "http://127.0.0.1:29090 {" in config
    assert "http://:28081" not in config
    assert "X-Fpl-Ingress local" in config
    assert "forward_auth " + addresses["identity"] in config
    assert "request_header -X-Fpl-*" in config
    assert "@unknown_api" in config
    assert "respond @internal 404" in config


def test_compose_interpolation_fails_closed_for_missing_required_inputs():
    assert interpolate("${IMAGE:?required} ${PORT:-3000}", {"IMAGE": "existing"}) == "existing 3000"
    with pytest.raises(ValueError, match="STATE"):
        interpolate("${STATE:?must exist}", {})
    assert mapped(
        {"credential": "existing-secret", "database": "/state/service.db"}, {"/state": "/owned"}
    ) == {"credential": "existing-secret", "database": "/owned/service.db"}


def test_duplicate_native_start_preserves_the_running_process_record(tmp_path, capsys):
    from scripts.website.native_development import run

    from studio.runtime.lifecycle.locking import service_lock

    directory = tmp_path / ".runtime/native-development"
    (directory / "tools").mkdir(parents=True)
    (directory / "tools/caddy").touch()
    record = directory / "process.json"
    record.write_text('{"pid": 12345}')
    with service_lock(directory):
        run(tmp_path)
    assert record.read_text() == '{"pid": 12345}'
    assert "无需重复启动" in capsys.readouterr().out


def test_shutdown_still_cleans_descendants_when_the_parent_has_exited(monkeypatch):
    import signal
    from unittest.mock import Mock

    from scripts.website import native_development

    child = Mock(pid=12345)
    child.poll.return_value = 0
    child.wait.return_value = 0
    kill = Mock()
    monkeypatch.setattr(native_development.os, "killpg", kill)
    native_development.stop_process(child)
    kill.assert_any_call(child.pid, signal.SIGTERM)
    kill.assert_any_call(child.pid, signal.SIGKILL)
