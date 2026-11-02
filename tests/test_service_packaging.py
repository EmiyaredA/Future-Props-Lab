"""Image and Compose boundaries reject hidden monolith dependencies and host mounts."""

from pathlib import Path

import pytest
import yaml

from fpl_deployment.images import source_closure

ROOT = Path(__file__).resolve().parents[1]


def test_identity_source_closure_does_not_package_unrelated_business():
    closure = source_closure(ROOT, "identity")
    assert "fpl_identity.application" in closure
    assert "app.console.governance.account_creation" in closure
    for name in closure:
        assert not name.startswith(("app.llm", "app.apps", "app.capabilities.asset_store"))
        assert name not in {"app.orm", "app.main", "app.api"}
    assert all(path.suffix == ".py" for path in closure.values())


def test_image_preparation_refuses_a_hidden_monolith_import(tmp_path):
    own = tmp_path / "backend/fpl_identity"
    own.mkdir(parents=True)
    (own / "__main__.py").write_text("import app.main\n")
    foreign = tmp_path / "backend/app"
    foreign.mkdir()
    (foreign / "main.py").write_text("# unrelated monolith\n")
    with pytest.raises(ValueError, match="越界依赖"):
        source_closure(tmp_path, "identity")


def test_compose_only_publishes_gateway_and_mounts_minimal_owned_state():
    document = yaml.safe_load((ROOT / "deploy/compose.yaml").read_text())
    for name, service in document["services"].items():
        assert service["read_only"] is True
        if name == "gateway":
            assert all(port.startswith("127.0.0.1:") for port in service["ports"])
            assert "ingress" in service["networks"]
            continue
        assert "ports" not in service
        assert service["networks"] == ["private"]
        state = next(v for v in service["volumes"] if v["target"] == "/state")
        assert "FPL_" + name.upper().replace("-", "_") + "_STATE" in state["source"]
        for volume in service["volumes"]:
            assert volume["bind"]["create_host_path"] is False
            assert "docker.sock" not in volume["source"]
            assert "/Users/" not in volume["source"] and "~/" not in volume["source"]
            if volume["target"] != "/state":
                assert volume["read_only"] is True
    assert document["networks"]["private"]["internal"] is True


def test_agents_image_contains_no_identity_orm_or_native_readers():
    closure = source_closure(ROOT, "agents")
    assert "fpl_agents.application" in closure
    assert "app.apps.agent_workbench.models" in closure
    assert "app.apps.agent_workbench.sync.projection" in closure
    for name in closure:
        assert not name.startswith(("fpl_identity", "fpl_host", "app.console.models", "app.llm"))
        assert name not in {
            "app.main",
            "app.orm",
            "app.api",
            "app.deps",
            "app.capabilities.agents.sessions.catalog",
        }


def test_native_queue_models_do_not_pollute_legacy_schema():
    from app.runtime.orm_base import Base
    from fpl_agents.application import MODELS
    from fpl_agents.models import NativeJob, NativeProjectionReceipt, NativeSubscription

    assert all(
        model in MODELS for model in (NativeJob, NativeSubscription, NativeProjectionReceipt)
    )
    assert "agent_native_jobs" not in Base.metadata.tables


def test_gateway_image_contains_no_business_or_identity_database():
    closure = source_closure(ROOT, "gateway")
    assert "fpl_gateway.application" in closure
    assert "fpl_runtime.capability_client" in closure
    assert not any(
        name.startswith(("app.apps", "app.llm", "app.console.models", "fpl_identity", "fpl_host"))
        for name in closure
    )
    assert not {"app.main", "app.orm", "app.api", "app.deps"}.intersection(closure)


def test_renderer_packages_only_owned_media_processing_and_no_foreign_storage():
    closure = source_closure(ROOT, "rendering")
    assert "fpl_rendering.application" in closure
    assert "app.capabilities.media_rendering.pdf_preview_worker" in closure
    assert not any(
        name.startswith(
            (
                "app.apps.",
                "app.llm.",
                "app.console.models",
                "app.capabilities.asset_store.models",
                "fpl_assets",
            )
        )
        for name in closure
    )
