"""Image and Compose boundaries reject hidden monolith dependencies and host mounts."""

import os
import stat
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from studio.deployment.images import ENTRY_POINTS, public_client_module, source_closure
from studio.host.deployment.deployment_preflight import MIGRATION_MODULES

ROOT = Path(__file__).resolve().parents[2]


def test_identity_source_closure_does_not_package_unrelated_business():
    closure = source_closure(ROOT, "identity")
    assert "studio.assembly.independent.identity.application" in closure
    assert "studio.apps.identity.registration.accounts" in closure
    for name in closure:
        if public_client_module(name):
            continue
        assert not name.startswith(
            ("studio.apps.model_service", "app.apps", "studio.apps.asset_library")
        )
        assert name not in {
            "studio.assembly.website.models",
            "studio.assembly.website.application",
            "studio.assembly.website.routes",
            "studio.runtime.database.website",
        }
    assert all(path.suffix == ".py" for path in closure.values())


@pytest.mark.parametrize(
    "module", ["studio.assembly.website.application", "studio.runtime.database.website"]
)
def test_image_preparation_refuses_a_hidden_monolith_import(tmp_path, module):
    own = (tmp_path / "backend" / ENTRY_POINTS["identity"].replace(".", "/")).with_suffix(".py")
    own.parent.mkdir(parents=True)
    own.write_text("import " + module + "\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True)
    foreign.write_text("# unrelated monolith\n")
    with pytest.raises(ValueError, match="越界依赖|非服务运行依赖"):
        source_closure(tmp_path, "identity")


def test_compose_only_publishes_gateway_and_mounts_minimal_owned_state():
    document = yaml.safe_load((ROOT / "deploy/compose/compose.yaml").read_text())
    assert MIGRATION_MODULES.keys() == ENTRY_POINTS.keys()
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


def test_native_queue_models_do_not_pollute_legacy_schema():
    from studio.apps.agent_workbench.storage.service_models import (
        NativeJob,
        NativeProjectionReceipt,
        NativeSubscription,
    )
    from studio.assembly.independent.agent_workbench.application import MODELS
    from studio.runtime.database.orm_base import Base

    assert all(
        model in MODELS for model in (NativeJob, NativeSubscription, NativeProjectionReceipt)
    )
    assert "agent_native_jobs" not in Base.metadata.tables


def test_gateway_image_contains_no_business_or_identity_database():
    closure = source_closure(ROOT, "gateway")
    assert "studio.assembly.independent.gateway.application" in closure
    assert "studio.runtime.http.capability_client" in closure
    assert not any(
        name.startswith(
            (
                "app.apps",
                "studio.apps.model_service",
                "app.console.models",
                "studio.apps.identity",
                "studio.host",
            )
        )
        for name in closure
        if not public_client_module(name)
    )
    assert not {
        "studio.assembly.website.application",
        "studio.assembly.website.models",
        "studio.assembly.website.routes",
        "studio.assembly.http_dependencies",
    }.intersection(closure)


def test_renderer_packages_only_owned_media_processing_and_no_foreign_storage():
    closure = source_closure(ROOT, "rendering")
    assert "studio.assembly.independent.media_rendering.application" in closure
    assert "studio.apps.media_rendering.local.pdf_preview_worker" in closure
    assert not any(
        name.startswith(
            (
                "app.apps.",
                "studio.apps.model_service.",
                "app.console.models",
                "studio.apps.asset_library.storage.models",
                "studio.apps.asset_library",
            )
        )
        for name in closure
        if not public_client_module(name)
    )


@pytest.mark.parametrize(
    "module",
    [
        "studio.runtime.database.website",
        "studio.apps.identity.storage.models.accounts",
        "studio.apps.asset_library.storage.file_paths",
        "studio.apps.thought_workshop.storage.models",
    ],
)
def test_models_image_rejects_hidden_cross_service_storage(tmp_path, module):
    own = (tmp_path / "backend" / ENTRY_POINTS["models"].replace(".", "/")).with_suffix(".py")
    own.parent.mkdir(parents=True)
    own.write_text("import " + module + "\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True, exist_ok=True)
    foreign.write_text("# forbidden storage owner\n")
    with pytest.raises(ValueError, match="(?i)models 镜像包含越界依赖"):
        source_closure(tmp_path, "models")


def test_models_overlay_owns_state_and_has_provider_egress_without_host_mounts():
    document = yaml.safe_load((ROOT / "deploy/compose/models.compose.yaml").read_text())
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
    [
        "studio.runtime.database.website",
        "studio.apps.identity.storage.models.accounts",
        "studio.apps.model_service.storage.models",
        "studio.host.session_collection.collector",
    ],
)
def test_integrations_image_refuses_foreign_storage_and_native_executors(tmp_path, module):
    own = (tmp_path / "backend" / ENTRY_POINTS["integrations"].replace(".", "/")).with_suffix(".py")
    own.parent.mkdir(parents=True)
    own.write_text("import " + module + "\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True, exist_ok=True)
    foreign.write_text("# foreign implementation\n")
    with pytest.raises(ValueError, match="(?i)integrations 镜像包含(?:越界|非服务运行)依赖"):
        source_closure(tmp_path, "integrations")


def test_integrations_image_packages_owned_http_and_only_file_value_contracts():
    closure = source_closure(ROOT, "integrations")
    assert "studio.assembly.independent.integrations.application" in closure
    assert "studio.apps.integrations.transport.catalog_http" in closure
    assert "studio.contracts.asset_library.incoming" in closure
    assert not any(
        name.startswith(
            (
                "studio.apps.model_service",
                "app.console",
                "app.apps",
                "studio.host",
                "studio.apps.asset_library",
            )
        )
        for name in closure
        if not public_client_module(name)
    )


def test_models_image_includes_the_local_model_runtime_manifest(monkeypatch):
    from studio.deployment import images

    original = images.subprocess.run

    def run(command, **kwargs):
        if command[:2] == ["uv", "export"]:
            return SimpleNamespace(returncode=0, stdout=b"# isolated package fixture\n")
        return original(command, **kwargs)

    monkeypatch.setattr(images.subprocess, "run", run)
    context, metadata = images.prepare_image(ROOT, "models")
    name = "backend/studio/config/local_models.json"
    assert name in metadata["files"]
    assert (context / name).read_bytes() == (ROOT / name).read_bytes()
    assert (context / "web/.api-only").is_file()


def test_service_image_payload_is_readable_by_nonroot_under_private_umask(tmp_path, monkeypatch):
    from studio.deployment import images

    source = tmp_path / "backend/studio/entry.py"
    for path in (
        source,
        tmp_path / "deploy/images/owned-http/Dockerfile",
        tmp_path / "deploy/contracts/ownership.json",
        tmp_path / "web/src/generated/openapi.json",
        tmp_path / "backend/studio/contracts/gateway/automation_operations.json",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# fixture\n")
    monkeypatch.setattr(images, "source_closure", lambda *_: {"entry": source})
    monkeypatch.setattr(
        images.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(stdout=b"", returncode=0),
    )

    original = os.umask(0o077)
    try:
        context, release = images.prepare_image(tmp_path, "amadeus")
    finally:
        os.umask(original)

    assert stat.S_IMODE(context.stat().st_mode) == 0o700
    assert stat.S_IMODE((context / "service-entry.py").stat().st_mode) == 0o644
    assert stat.S_IMODE((context / "backend/studio").stat().st_mode) == 0o755
    assert stat.S_IMODE((context / "backend/studio/entry.py").stat().st_mode) == 0o644
    assert images.prepare_image(tmp_path, "amadeus")[1]["image"] == release["image"]


def test_integrations_compose_uses_owned_data_and_outbound_only_provider_network():
    document = yaml.safe_load((ROOT / "deploy/compose/integrations.compose.yaml").read_text())
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
    from studio.apps.integrations.records import ExternalExecution, ValidationAttempt
    from studio.apps.integrations.storage.demo_records import DemoToolInstallation
    from studio.apps.integrations.storage.native_mcp_records import (
        NativeMcpJob,
        NativeMcpObservation,
    )
    from studio.apps.model_service.storage.demo_install_records import DemoInstallation
    from studio.apps.model_service.storage.integration_records import IntegrationCapacity
    from studio.runtime.database.orm_base import Base

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
    assert {
        "studio.assembly.independent.thought_workshop.cli",
        "studio.assembly.independent.thought_workshop.application",
    } <= closure.keys()
    assert "studio.apps.thought_workshop.publication.official_source" in closure
    assert "studio.apps.thought_workshop.publication.assets" not in closure
    assert "studio.apps.asset_library.storage.models" not in closure
    assert "studio.runtime.database.website" not in closure

    services = yaml.safe_load((ROOT / "deploy/compose/thought.compose.yaml").read_text())[
        "services"
    ]
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
    assert f"studio.assembly.independent.{service}_workshop.application" in closure
    assert f"studio.apps.{service}_workshop.storage.models" in closure
    forbidden = (
        f"studio.apps.{other}_workshop",
        f"studio.apps.{other}_workshop",
        "studio.apps.asset_library.storage.models",
        "studio.runtime.database.website",
        "studio.apps.model_service.storage.models",
        "studio.apps.model_service.providers",
        "studio.apps.model_service.generation",
        "studio.assembly.website.application",
        "studio.apps.creative_workshop",
        "studio.apps.identity",
    )
    assert not any(
        name == prefix or name.startswith(prefix + ".")
        for name in closure
        if not public_client_module(name)
        for prefix in forbidden
    )

    compose = yaml.safe_load((ROOT / "deploy/compose/project-owners.compose.yaml").read_text())
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
    assert (
        "studio.assembly.independent.tools.application" in closure
        and "studio.apps.tools.storage.navigation_models" in closure
    )
    assert not any(
        name.startswith(
            (
                "app.apps.",
                "app.console.",
                "studio.host",
                "studio.apps.asset_library",
                "studio.apps.identity",
            )
        )
        or name
        in {
            "studio.assembly.website.application",
            "studio.assembly.website.models",
            "studio.runtime.database.website",
        }
        for name in closure
        if not public_client_module(name)
    )
    tools = yaml.safe_load((ROOT / "deploy/compose/tools.compose.yaml").read_text())["services"][
        "tools"
    ]
    assert tools["read_only"] and tools["networks"] == ["private"] and "ports" not in tools
    assert set(mount["target"] for mount in tools["volumes"]) == {
        "/state",
        "/run/fpl/identity-public.pem",
    }
    assert all(not mount["bind"]["create_host_path"] for mount in tools["volumes"])
