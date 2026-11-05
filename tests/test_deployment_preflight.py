"""The host checks selected service schemas before any deployment action."""

import pytest

from studio.contracts.gateway.catalog import BY_ID
from studio.host.deployment import deployment_preflight


def test_all_selected_service_databases_are_checked_without_writing(monkeypatch, tmp_path):
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
    deployment_preflight.check_selected_databases(environment, owners, tmp_path)
    assert {name for _, name, _ in seen} == owners
    assert all(path == tmp_path / name / "service.db" and registry for path, name, registry in seen)
    assert not list(tmp_path.iterdir())


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
    control = SimpleNamespace(env={}, prefix=["docker", "compose"], services=["assets"])
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
