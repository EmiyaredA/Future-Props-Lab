"""The host checks selected service schemas and Creative credentials before deployment."""

import json
from pathlib import Path

import pytest

from studio.contracts.gateway.catalog import BY_ID
from studio.host.deployment import deployment_preflight
from studio.host.deployment.management_control import DeploymentControl


@pytest.fixture
def creative_credentials(tmp_path):
    data = {
        "FPL_IDENTITY_SERVICE_CREDENTIALS": json.dumps(
            {"gateway": "gateway-service-fixture-" * 3, "creative": "creative-service-fixture-" * 3}
        ),
        "FPL_GATEWAY_IDENTITY_TOKEN": "gateway-service-fixture-" * 3,
        "FPL_GATEWAY_TOKEN": "website-ingress-fixture-" * 3,
        "FPL_MANAGEMENT_GATEWAY_TOKEN": "management-ingress-fixture-" * 3,
    }
    environment = {}
    for name, body in data.items():
        path = tmp_path / name
        path.write_text(body + "\n")
        environment[name] = str(path)
    return environment


def test_all_selected_service_databases_are_checked_without_writing(
    monkeypatch, tmp_path, creative_credentials
):
    seen = []
    monkeypatch.setattr(
        deployment_preflight,
        "check",
        lambda path, name, registry: seen.append((path, name, registry)),
    )
    owners = BY_ID.keys()
    environment = {
        f"FPL_{name.upper().replace('-', '_')}_{field}": value
        for name in owners
        for field, value in (("IMAGE", "test-image"), ("STATE", name))
    }
    environment.update(creative_credentials)
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    deployment_preflight.check_selected_databases(environment, owners, tmp_path)
    assert {name for _, name, _ in seen} == owners
    assert all(path == tmp_path / name / "service.db" and registry for path, name, registry in seen)
    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("FPL_GATEWAY_TOKEN", "独立于入口凭据"),
        ("FPL_MANAGEMENT_GATEWAY_TOKEN", "独立于入口凭据"),
        ("FPL_IDENTITY_SERVICE_CREDENTIALS", "独立于入口凭据"),
        ("FPL_GATEWAY_IDENTITY_TOKEN", "与 Identity 登记一致"),
    ],
)
def test_invalid_creative_gateway_credentials_block_preflight(
    monkeypatch, tmp_path, creative_credentials, name, message
):
    environment = {**creative_credentials, "FPL_CREATIVE_IMAGE": "test-image"}
    credential = (tmp_path / "FPL_GATEWAY_IDENTITY_TOKEN").read_text().strip()
    invalid = credential
    if name == "FPL_IDENTITY_SERVICE_CREDENTIALS":
        invalid = json.dumps({"gateway": credential, "creative": credential})
    if name == "FPL_GATEWAY_IDENTITY_TOKEN":
        invalid = "different-gateway-fixture-" * 3
    (tmp_path / name).write_text(invalid)
    monkeypatch.setattr(
        deployment_preflight,
        "check",
        lambda *_args: pytest.fail("must fail before reading schemas"),
    )
    with pytest.raises(ValueError, match=message):
        deployment_preflight.check_selected_databases(environment, ["creative"], tmp_path)


async def test_creative_restart_checks_credentials_before_stopping(tmp_path, creative_credentials):
    credential = (tmp_path / "FPL_GATEWAY_IDENTITY_TOKEN").read_text()
    (tmp_path / "FPL_GATEWAY_TOKEN").write_text(credential)
    control = DeploymentControl(
        compose_file=Path("deploy/compose/compose.yaml"),
        project_name="isolated-credential-restart",
        services=["creative", "integrations"],
        environment={
            **creative_credentials,
            "FPL_CREATIVE_IMAGE": "creative-fixture",
            "FPL_INTEGRATIONS_IMAGE": "integrations-fixture",
        },
        tunnels={},
        runner=lambda *_args, **_kwargs: pytest.fail("invalid credentials must not invoke Compose"),
    )

    async def authorize():
        pass

    with pytest.raises(ValueError, match="独立于入口凭据"):
        await control.execute("management.application", {"action": "restart"}, authorize)


def test_management_only_does_not_require_stopped_business_databases(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(
        deployment_preflight, "check", lambda _path, name, _registry: seen.append(name)
    )
    environment = {
        "FPL_IDENTITY_STATE": "identity",
        "FPL_MANAGEMENT_STATE": "management",
        "FPL_ASSETS_IMAGE": "asset-image",
        "FPL_MODELS_IMAGE": "model-image",
        "FPL_MODELS_STATE": "models",
    }
    deployment_preflight.check_selected_databases(
        environment, ["assets"], tmp_path, only_management=True
    )
    assert set(seen) == {"identity", "management", "models"}


def test_unknown_configured_service_and_missing_state_fail_closed(monkeypatch, tmp_path):
    monkeypatch.setattr(deployment_preflight, "check", lambda *_args: None)
    environment = {
        "FPL_IDENTITY_STATE": "identity",
        "FPL_MANAGEMENT_STATE": "management",
        "FPL_UNREGISTERED_IMAGE": "test",
    }
    with pytest.raises(ValueError, match="尚未提供"):
        deployment_preflight.check_selected_databases(environment, ["unregistered"], tmp_path)
    del environment["FPL_MANAGEMENT_STATE"]
    with pytest.raises(ValueError, match="状态目录"):
        deployment_preflight.check_selected_databases(environment, [], tmp_path)


def test_real_outdated_service_schema_is_rejected_without_migrating(tmp_path):
    from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS as AGENTS
    from studio.apps.identity.storage.migrations.registry import MIGRATIONS as IDENTITY
    from studio.apps.management.storage.migrations.registry import MIGRATIONS as MANAGEMENT
    from studio.runtime.database.migrations import apply

    for service, registry in (
        ("identity", IDENTITY),
        ("management", MANAGEMENT),
        ("agents", AGENTS[:-1]),
    ):
        directory = tmp_path / service
        directory.mkdir()
        apply(directory / "service.db", service, registry)
    environment = {
        "FPL_IDENTITY_STATE": "identity",
        "FPL_MANAGEMENT_STATE": "management",
        "FPL_AGENTS_STATE": "agents",
        "FPL_AGENTS_IMAGE": "fixture",
    }
    before = (tmp_path / "agents/service.db").read_bytes()
    with pytest.raises(ValueError):
        deployment_preflight.check_selected_databases(environment, ["agents"], tmp_path)
    assert (tmp_path / "agents/service.db").read_bytes() == before


def test_launcher_does_not_invoke_compose_when_selected_database_fails(monkeypatch, tmp_path):
    import sys
    from contextlib import nullcontext
    from types import SimpleNamespace

    from scripts.management import start

    config = tmp_path / "config.toml"
    environment = {"FPL_MANAGEMENT_IMAGE": "fixture"}
    control = SimpleNamespace(
        env={}, prefix=["docker", "compose"], services=["assets"], project_directory=tmp_path
    )
    monkeypatch.setattr(
        start, "read_config", lambda _path: {"fpl_deployment_environment": environment}
    )
    monkeypatch.setattr(
        "studio.assembly.host.management.configuration", lambda _path: ({}, control, None, tmp_path)
    )
    monkeypatch.setattr(start, "service_lock", lambda _state: nullcontext())
    monkeypatch.setattr(sys, "argv", ["start", "--config", str(config)])
    calls = []
    monkeypatch.setattr(
        start.subprocess, "run", lambda *args, **kwargs: calls.append((args, kwargs))
    )

    def reject(*_args, **_kwargs):
        raise ValueError("outdated isolated schema")

    monkeypatch.setattr(deployment_preflight, "check_selected_databases", reject)
    with pytest.raises(ValueError, match="outdated isolated schema"):
        start.main()
    assert calls == []


def test_selected_service_without_pinned_image_fails_before_opening_any_database(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(
        deployment_preflight, "check", lambda *_args: pytest.fail("must fail before reading")
    )
    with pytest.raises(ValueError, match="缺少发布镜像：tools"):
        deployment_preflight.check_selected_databases({}, ["tools"], tmp_path)
