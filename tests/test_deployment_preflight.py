"""The host checks selected service schemas before any deployment action."""

import pytest

from fpl_host import deployment_preflight


def test_all_selected_service_databases_are_checked_without_writing(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(
        deployment_preflight,
        "check",
        lambda path, name, registry: seen.append((path, name, registry)),
    )
    environment = {
        f"FPL_{name.upper()}_{field}": value
        for name in ("identity", "management", "models", "assets", "integrations")
        for field, value in (("IMAGE", "test-image"), ("STATE", name))
    }
    deployment_preflight.check_selected_databases(
        environment, ["assets", "integrations", "visual"], tmp_path
    )
    assert {name for _, name, _ in seen} == {
        "identity",
        "management",
        "models",
        "assets",
        "integrations",
    }
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
        "FPL_VISUAL_IMAGE": "visual",
    }
    with pytest.raises(ValueError, match="尚未提供"):
        deployment_preflight.check_selected_databases(environment, ["visual"], tmp_path)
    del environment["FPL_MANAGEMENT_STATE"]
    with pytest.raises(ValueError, match="状态目录"):
        deployment_preflight.check_selected_databases(environment, [], tmp_path)


def test_real_outdated_service_schema_is_rejected_without_migrating(tmp_path):
    from fpl_agents.migrations.registry import MIGRATIONS as AGENTS
    from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY
    from fpl_management.migrations.registry import MIGRATIONS as MANAGEMENT
    from fpl_runtime.migrations import apply

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
        "fpl_host.management.configuration", lambda _path: ({}, control, None, tmp_path)
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
