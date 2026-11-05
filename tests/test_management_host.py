"""Host commands are fixed, local receipts survive ambiguity, and gateways stay separate."""

import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from studio.contracts.agent_workbench.native import NativeLease
from studio.contracts.gateway.routing import RouteCatalog
from studio.deployment.gateway import render_gateway
from studio.deployment.images import public_client_module, source_closure
from studio.host.deployment.management_control import DeploymentControl, redact
from studio.host.receipts import ReceiptStore

ROOT = Path(__file__).resolve().parents[1]


class Tunnel:
    def snapshot(self):
        return {"phase": "off", "url": "", "error": "", "build_id": ""}

    async def action(self, action):
        return {"phase": action}


def control(tmp_path, runner):
    compose = tmp_path / "compose.yaml"
    compose.write_text("services: {}\n")
    return DeploymentControl(
        compose_file=compose,
        project_name="isolated-test",
        services=["gateway", "portal", "agents"],
        environment={},
        tunnels={"business": Tunnel(), "management": Tunnel()},
        runner=runner,
    )


@pytest.mark.asyncio
async def test_fixed_commands_do_not_stop_governance_or_accept_arbitrary_arguments(tmp_path):
    calls = []

    def runner(command, **_kwargs):
        calls.append(command)
        assert command[:4] == ["docker", "compose", "--env-file", "/dev/null"]
        assert _kwargs["env"]["COMPOSE_DISABLE_ENV_FILE"] == "true"
        output = (
            (
                (
                    '[{"Service":"gateway","State":"running"},'
                    '{"Service":"portal","State":"running"},'
                    '{"Service":"agents","State":"running"}]'
                )
                if not any("kill" in call for call in calls)
                else "[]"
            )
            if "ps" in command
            else ""
        )
        return SimpleNamespace(returncode=0, stdout=output)

    managed = control(tmp_path, runner)

    async def allowed():
        return None

    await managed.execute("management.application", {"action": "stop"}, allowed)
    assert any(command[-4:] == ["SIGTERM", "gateway", "portal", "agents"] for command in calls)
    assert not any(
        "identity" in command or "management" in command or "models" in command for command in calls
    )
    with pytest.raises(ValueError):
        await managed.execute(
            "management.application", {"action": "start", "command": "rm"}, allowed
        )
    with pytest.raises(ValueError):
        await managed.execute("management.logs", {"path": "/etc/passwd"}, allowed)
    with pytest.raises(ValueError):
        await managed.execute("shell", {}, allowed)


@pytest.mark.asyncio
async def test_revoked_authorization_prevents_all_host_execution(tmp_path):
    managed = control(tmp_path, lambda *_args, **_kwargs: pytest.fail("executed host command"))

    async def denied():
        raise ValueError("revoked")

    with pytest.raises(ValueError, match="revoked"):
        await managed.execute("management.application", {"action": "start"}, denied)


def test_receipt_intent_with_unknown_outcome_never_repeats_command(tmp_path):
    lease = NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="admin",
        operation="management.application",
        payload={"arguments": {"action": "start"}},
        lease_expires_at="2026-11-02T00:00:00",
    )
    store = ReceiptStore(tmp_path / "receipts")
    calls = []

    def interrupted(*_args):
        calls.append(True)
        raise RuntimeError("lost result")

    first = store.execute(lease, interrupted)
    second = store.execute(lease, lambda *_args: pytest.fail("repeated command"))
    assert first.status == second.status == "unknown" and len(calls) == 1


def test_management_image_excludes_business_and_host_implementations():
    closure = source_closure(ROOT, "management")
    assert "studio.assembly.independent.management.application" in closure
    assert not any(
        name.startswith(
            ("studio.apps.identity", "studio.host", "app.console.models", "app.apps", "app.llm")
        )
        for name in closure
        if not public_client_module(name)
    )


def test_gateway_audiences_have_disjoint_control_paths_and_native_lane():
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    business = render_gateway(
        catalog,
        gateway_token="business_token_" * 3,
        local_origin="http://127.0.0.1:9000",
        public_origin="https://studio.example.test",
    )
    management = render_gateway(
        catalog,
        gateway_token="management_token_" * 3,
        local_origin="http://127.0.0.1:9002",
        public_origin="https://admin.example.test",
        audience="management",
        control=True,
        native_tokens={"management": "native_token_" * 3},
        native_port=29092,
    )
    assert "management:8080" not in business and "v1/platform" not in business
    assert "management/application" in management and "agent-workbench/sessions" not in management
    assert "127.0.0.1:29092" in management and "header Origin *" in management
    assert "request_header -X-Fpl-*" in business and "request_header -X-Fpl-*" in management


@pytest.mark.parametrize(
    "line",
    [
        "Authorization: Bearer abc123",
        "api_key=sk-secret-value",
        '{"password": "secret words"}',
        "https://user:password@example.test/path",
        "fpm_privatekey",
    ],
)
def test_logs_redact_credentials(line):
    value = redact(line)
    assert "secret" not in value and "abc123" not in value and "password@" not in value


@pytest.mark.asyncio
async def test_stop_timeout_requires_a_separate_force_command(tmp_path):
    calls = []

    def runner(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout='[{"Service":"gateway","State":"running"}]')

    managed = control(tmp_path, runner)
    ticks = iter((0, 31))
    managed.clock = lambda: next(ticks)

    async def allowed():
        return None

    with pytest.raises(RuntimeError, match="30"):
        await managed.execute("management.application", {"action": "stop"}, allowed)
    assert managed.force and not any("SIGKILL" in command for command in calls)
    await managed.execute("management.application", {"action": "force_stop"}, allowed)
    assert any("SIGKILL" in command for command in calls)


@pytest.mark.asyncio
async def test_two_tunnels_can_stop_independently(tmp_path):
    import asyncio

    from app.capabilities.web_access.contracts import GatewayProfile
    from studio.host.deployment.management_tunnels import GatewayTunnel

    class SimulatedTunnel(GatewayTunnel):
        async def check(self, **_kwargs):
            return None

        async def follow(self):
            self.phase = "ready"
            await asyncio.Event().wait()

    first = SimulatedTunnel(GatewayProfile(), tmp_path, service="gateway")
    second = SimulatedTunnel(GatewayProfile(), tmp_path, service="management")
    await first.action("public_start")
    await second.action("public_start")
    await asyncio.sleep(0)
    await first.action("public_stop")
    assert not first.enabled and second.enabled and second.phase == "ready"
    await second.close()


@pytest.mark.asyncio
async def test_tunnel_rejects_mismatched_gateway_builds(tmp_path, monkeypatch):
    import httpx

    from app.capabilities.web_access.contracts import GatewayProfile
    from studio.host.deployment.management_tunnels import GatewayTunnel

    token = "a" * 32
    for kind in ("identity", "known_hosts"):
        path = tmp_path / f"{token}.{kind}"
        path.write_text("isolated test credential")
        path.chmod(0o600)
    profile = GatewayProfile(
        origin="https://admin.example.test",
        host="gateway.example.test",
        user="tunnel",
        identity_id=token,
        known_hosts_id=token,
    )

    def response(request):
        return httpx.Response(
            200,
            json={
                "service": "management",
                "build_id": "a" * 20 if request.url.host == "127.0.0.1" else "b" * 20,
            },
        )

    client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(response), **kwargs),
    )
    tunnel = GatewayTunnel(profile, tmp_path, service="management")
    with pytest.raises(ValueError, match="构建不一致"):
        await tunnel.check()


def test_management_overlay_has_only_its_own_state_and_no_host_secrets():
    import yaml

    document = yaml.safe_load((ROOT / "deploy/management.compose.yaml").read_text())
    service = document["services"]["management"]
    assert service["read_only"] is True and service["cap_drop"] == ["ALL"]
    for volume in service["volumes"]:
        assert volume["bind"]["create_host_path"] is False
        assert "docker.sock" not in volume["source"] and "/Users/" not in volume["source"]
        assert "signing" not in volume["source"] and "ssh" not in volume["source"].lower()
        if volume["target"] == "/state":
            assert "FPL_MANAGEMENT_STATE" in volume["source"]
        else:
            assert volume["read_only"] is True
    assert all(port.startswith("127.0.0.1:") for port in service["ports"])


@pytest.mark.asyncio
async def test_native_tunnel_uses_the_single_management_public_origin(tmp_path):
    import json

    from studio.assembly.host.management import configuration

    backend = tmp_path / "backend"
    backend.mkdir()
    compose = tmp_path / "compose.yaml"
    compose.write_text("services: {}\n")
    credential = tmp_path / "worker-token"
    credential.write_text("a" * 48)
    credential.chmod(0o600)
    config = backend / "config.toml"
    config.write_text(
        '[management]\npublic_origin = "https://admin.example.test"\n'
        "[deployment]\ncompose_file = " + json.dumps(str(compose)) + "\n"
        'project_name = "isolated"\n[management_host]\n'
        'base_url = "http://127.0.0.1:29092/management"\ncredential_file = '
        + json.dumps(str(credential))
        + '\nbusiness_services = ["gateway", "portal"]\n'
    )
    _, control, transport, _ = configuration(config)
    assert control.tunnels["management"].profile.origin == "https://admin.example.test"
    await transport.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["exited", "unhealthy", "missing"])
async def test_partial_business_crash_keeps_siblings_running_and_recovers(tmp_path, failure):
    calls = []
    recovered = False

    def runner(command, **_kwargs):
        calls.append(command)
        rows = [{"Service": name, "State": "running"} for name in ("gateway", "portal", "agents")]
        if not recovered:
            if failure == "missing":
                rows.pop(1)
            elif failure == "unhealthy":
                rows[1]["Health"] = "unhealthy"
            else:
                rows[1]["State"] = "exited"
        return SimpleNamespace(returncode=0, stdout=json.dumps(rows) if "ps" in command else "")

    managed = control(tmp_path, runner)
    managed.expected_running = True
    state = await managed.supervise()
    assert state["application"]["phase"] == "failed"
    assert not any("kill" in command or "stop" in command for command in calls)
    assert "其他服务继续运行" in state["application"]["error"]
    assert not any(
        "identity" in command or "models" in command or "management" in command for command in calls
    )
    assert (await managed.supervise())["application"]["phase"] == "failed"
    recovered = True
    state = await managed.supervise()
    assert state["application"]["phase"] == "running"
    assert state["application"]["error"] == ""


@pytest.mark.asyncio
async def test_all_business_processes_exit_unexpectedly_keeps_failure(tmp_path):
    managed = control(
        tmp_path, lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout="[]")
    )
    managed.expected_running = True
    assert (await managed.supervise())["application"]["phase"] == "failed"
    assert managed.expected_running
    assert (await managed.supervise())["application"]["phase"] == "failed"


@pytest.mark.asyncio
async def test_business_start_failure_preserves_running_services(tmp_path):
    calls = []

    def runner(command, **_kwargs):
        calls.append(command)
        if "up" in command:
            return SimpleNamespace(returncode=1, stdout="")
        states = (
            "[]"
            if any("kill" in call for call in calls)
            else '[{"Service":"agents","State":"running"}]'
        )
        return SimpleNamespace(returncode=0, stdout=states if "ps" in command else "")

    managed = control(tmp_path, runner)

    async def allowed():
        return None

    with pytest.raises(RuntimeError, match="部署操作失败"):
        await managed.execute("management.application", {"action": "start"}, allowed)
    assert (await managed.supervise())["application"]["phase"] == "failed"
    assert any("--no-deps" in command and "--wait" in command for command in calls)
    assert not any("kill" in command or "stop" in command for command in calls)


def test_models_overlay_is_only_selected_by_explicit_deployment_config(tmp_path, monkeypatch):
    monkeypatch.setenv("FPL_MODELS_IMAGE", "untrusted-shell-value")
    models = tmp_path / "models.compose.yaml"
    models.write_text("services: {}\n")
    implicit = control(tmp_path, lambda *_args, **_kwargs: None)
    assert str(models) not in implicit.prefix
    selected = DeploymentControl(
        compose_file=implicit.compose_file,
        project_name="isolated-test",
        services=["portal"],
        environment={"FPL_MODELS_IMAGE": "fpl/models:verified"},
        tunnels={},
    )
    assert selected.prefix.count(str(models)) == 1
    models.unlink()
    with pytest.raises(ValueError, match="缺少匹配"):
        DeploymentControl(
            compose_file=implicit.compose_file,
            project_name="isolated-test",
            services=["portal"],
            environment={"FPL_MODELS_IMAGE": "fpl/models:verified"},
            tunnels={},
        )


def test_integrations_overlay_requires_explicit_config_and_rejects_symlinks(tmp_path, monkeypatch):
    monkeypatch.setenv("FPL_INTEGRATIONS_IMAGE", "untrusted-shell-value")
    overlay = tmp_path / "integrations.compose.yaml"
    overlay.write_text("services: {}\n")
    implicit = control(tmp_path, lambda *_args, **_kwargs: None)
    assert str(overlay) not in implicit.prefix
    options = dict(
        compose_file=implicit.compose_file,
        project_name="isolated-test",
        services=["integrations"],
        environment={"FPL_INTEGRATIONS_IMAGE": "fpl/integrations:verified"},
        tunnels={},
    )
    selected = DeploymentControl(**options)
    assert selected.prefix.count(str(overlay)) == 1
    overlay.unlink()
    with pytest.raises(ValueError, match="缺少匹配"):
        DeploymentControl(**options)
    overlay.symlink_to(implicit.compose_file)
    with pytest.raises(ValueError, match="缺少匹配"):
        DeploymentControl(**options)


def test_thought_overlay_is_selected_only_by_explicit_release_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("FPL_THOUGHT_IMAGE", "untrusted-shell-value")
    overlay = tmp_path / "thought.compose.yaml"
    overlay.write_text("services: {}\n")
    implicit = control(tmp_path, lambda *_args, **_kwargs: None)
    assert str(overlay) not in implicit.prefix
    selected = DeploymentControl(
        compose_file=implicit.compose_file,
        project_name="isolated-test",
        services=["thought"],
        environment={"FPL_THOUGHT_IMAGE": "fpl/thought:verified"},
        tunnels={},
    )
    assert selected.prefix.count(str(overlay)) == 1
