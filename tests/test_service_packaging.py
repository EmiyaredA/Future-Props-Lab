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
        assert name not in {"app.orm", "app.main", "app.api", "app.runtime.db"}
    assert all(path.suffix == ".py" for path in closure.values())


@pytest.mark.parametrize("module", ["app.main", "app.runtime.db"])
def test_image_preparation_refuses_a_hidden_monolith_import(tmp_path, module):
    own = tmp_path / "backend/fpl_identity"
    own.mkdir(parents=True)
    (own / "__main__.py").write_text("import " + module + "\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True)
    foreign.write_text("# unrelated monolith\n")
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


@pytest.mark.parametrize(
    "module",
    [
        "app.runtime.db",
        "app.console.models.accounts",
        "app.capabilities.asset_store.storage",
        "app.apps.thought_workshop.models",
    ],
)
def test_models_image_rejects_hidden_cross_service_storage(tmp_path, module):
    own = tmp_path / "backend/fpl_models"
    own.mkdir(parents=True)
    (own / "__main__.py").write_text("import " + module + "\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True, exist_ok=True)
    foreign.write_text("# forbidden storage owner\n")
    with pytest.raises(ValueError, match="Models 镜像包含越界依赖"):
        source_closure(tmp_path, "models")


def test_models_overlay_owns_state_and_has_provider_egress_without_host_mounts():
    document = yaml.safe_load((ROOT / "deploy/models.compose.yaml").read_text())
    service = document["services"]["models"]
    assert set(document["services"]) == {"models"}
    assert service["read_only"] and service["cap_drop"] == ["ALL"]
    assert service["networks"] == ["private", "egress"]
    assert "ports" not in service
    assert document["networks"] == {"egress": {"driver": "bridge"}}
    for volume in service["volumes"]:
        assert volume["bind"]["create_host_path"] is False
        assert not any(
            value in volume["source"]
            for value in ("FPL_ASSETS", "SIGNING_KEY", "docker.sock", "/Users/")
        )
        if volume["target"] == "/state":
            assert "FPL_MODELS_STATE" in volume["source"]
        else:
            assert volume["read_only"] is True


@pytest.mark.parametrize(
    "module",
    ["app.runtime.db", "app.console.models.accounts", "app.llm.models", "fpl_host.collector"],
)
def test_integrations_image_refuses_foreign_storage_and_native_executors(tmp_path, module):
    own = tmp_path / "backend/fpl_integrations"
    own.mkdir(parents=True)
    (own / "__main__.py").write_text("import " + module + "\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True, exist_ok=True)
    foreign.write_text("# foreign implementation\n")
    with pytest.raises(ValueError, match="Integrations 镜像包含越界依赖"):
        source_closure(tmp_path, "integrations")


def test_integrations_image_packages_owned_http_and_only_file_value_contracts():
    closure = source_closure(ROOT, "integrations")
    assert "fpl_integrations.application" in closure
    assert "app.integrations.routes" in closure
    assert "app.capabilities.asset_store.incoming" in closure
    assert not any(
        name.startswith(("app.llm", "app.console", "app.apps", "fpl_host", "fpl_assets"))
        for name in closure
    )


def test_models_image_includes_the_local_model_runtime_manifest(monkeypatch):
    from types import SimpleNamespace

    from fpl_deployment import images

    original = images.subprocess.run

    def run(command, **kwargs):
        if command[:2] == ["uv", "export"]:
            return SimpleNamespace(returncode=0, stdout=b"# isolated package fixture\n")
        return original(command, **kwargs)

    monkeypatch.setattr(images.subprocess, "run", run)
    context, metadata = images.prepare_image(ROOT, "models")
    name = "backend/app/llm/local_models/manifest.json"
    assert name in metadata["files"]
    assert (context / name).read_bytes() == (ROOT / name).read_bytes()
    assert (context / "web/.api-only").is_file()


def test_integrations_compose_uses_owned_data_and_outbound_only_provider_network():
    document = yaml.safe_load((ROOT / "deploy/integrations.compose.yaml").read_text())
    service = document["services"]["integrations"]
    assert set(document["services"]) == {"integrations"}
    assert service["read_only"] and service["cap_drop"] == ["ALL"]
    assert service["networks"] == ["private", "egress"]
    assert "ports" not in service
    assert document["networks"] == {"egress": {"driver": "bridge"}}
    for volume in service["volumes"]:
        assert volume["bind"]["create_host_path"] is False
        assert not any(
            value in volume["source"]
            for value in ("FPL_ASSETS", "FPL_MODELS", "SIGNING_KEY", "docker.sock", "/Users/")
        )
        if volume["target"] == "/state":
            assert "FPL_INTEGRATIONS_STATE" in volume["source"]
        else:
            assert volume["read_only"] is True


def test_owned_service_receipts_do_not_register_with_the_recovery_database():
    from app.runtime.orm_base import Base
    from fpl_integrations.demo_records import DemoToolInstallation
    from fpl_integrations.native_mcp_records import NativeMcpJob, NativeMcpObservation
    from fpl_integrations.records import ExternalExecution, ValidationAttempt
    from fpl_models.demo_install_records import DemoInstallation
    from fpl_models.integration_records import IntegrationCapacity

    for model in (
        DemoToolInstallation,
        NativeMcpJob,
        NativeMcpObservation,
        ExternalExecution,
        ValidationAttempt,
        DemoInstallation,
        IntegrationCapacity,
    ):
        assert model.__table__.metadata is not Base.metadata


def test_thought_packages_own_release_and_only_purpose_scoped_asset_credentials():
    closure = source_closure(ROOT, "thought")
    assert {"fpl_thought.__main__", "fpl_thought.application"} <= closure.keys()
    assert "app.apps.thought_workshop.publication.official_source" in closure
    assert "app.apps.thought_workshop.publication.assets" not in closure
    assert "app.capabilities.asset_store.models" not in closure
    assert "app.runtime.db" not in closure

    services = yaml.safe_load((ROOT / "deploy/thought.compose.yaml").read_text())["services"]
    thought, assets = services["thought"], services["assets"]
    assert thought["networks"] == ["private"]
    assert thought["read_only"] and thought["cap_drop"] == ["ALL"]
    assert "ports" not in thought
    assert assets["command"] == ["serve", "--thought-peer", "/run/fpl/thought-peer.json"]
    assert len(assets["volumes"]) == 1
    assert assets["volumes"][0] in thought["volumes"]
    for volume in thought["volumes"]:
        assert volume["bind"]["create_host_path"] is False
        if volume["target"] == "/state":
            assert "FPL_THOUGHT_STATE" in volume["source"]
        else:
            assert volume["read_only"] is True


@pytest.mark.parametrize("service,other", [("visual", "galgame"), ("galgame", "visual")])
def test_project_owner_images_and_compose_mounts_are_isolated(service, other):
    closure = source_closure(ROOT, service)
    assert f"fpl_{service}.application" in closure
    assert f"app.apps.{service}_workshop.models" in closure
    forbidden = (
        f"fpl_{other}",
        f"app.apps.{other}_workshop",
        "app.capabilities.asset_store.models",
        "app.runtime.db",
        "app.main",
        "fpl_creative",
        "fpl_identity",
    )
    assert not any(
        name == prefix or name.startswith(prefix + ".") for name in closure for prefix in forbidden
    )

    compose = yaml.safe_load((ROOT / "deploy/project-owners.compose.yaml").read_text())
    unit = compose["services"][service]
    assert unit["read_only"] and unit["networks"] == ["private"] and "ports" not in unit
    state, credential, key = (
        next(mount for mount in unit["volumes"] if mount["target"] == target)
        for target in ("/state", "/run/fpl/identity-token", "/run/fpl/identity-public.pem")
    )
    assert f"FPL_{service.upper()}_STATE" in state["source"]
    assert f"FPL_{service.upper()}_IDENTITY_TOKEN" in credential["source"]
    assert credential["read_only"] and key["read_only"]
    assert all(not mount["bind"]["create_host_path"] for mount in unit["volumes"])


def test_tools_image_only_packages_owned_navigation_and_safe_mounts():
    closure = source_closure(ROOT, "tools")
    assert "fpl_tools.application" in closure and "app.tool_navigation.models" in closure
    assert not any(
        name.startswith(("app.apps.", "app.console.", "fpl_host", "fpl_assets", "fpl_identity"))
        or name in {"app.main", "app.orm", "app.runtime.db"}
        for name in closure
    )
    tools = yaml.safe_load((ROOT / "deploy/tools.compose.yaml").read_text())["services"]["tools"]
    assert tools["read_only"] and tools["networks"] == ["private"] and "ports" not in tools
    assert set(mount["target"] for mount in tools["volumes"]) == {
        "/state",
        "/run/fpl/identity-public.pem",
    }
    assert all(not mount["bind"]["create_host_path"] for mount in tools["volumes"])
