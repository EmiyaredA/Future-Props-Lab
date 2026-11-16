"""Prove the gates reject violations before applying them to the repository."""

from pathlib import Path

import pytest
from tests.architecture.dependency_policy import dependencies, discovers_tables, foreign_storage

APPS = Path(__file__).resolve().parents[2] / "backend/studio/apps"


@pytest.mark.parametrize(
    "source",
    [
        "from studio.apps.identity.storage.models.accounts import User",
        "from ..identity.storage.models import accounts",
        "def delayed():\n from studio.apps.identity.storage.models.accounts import User",
        "if TYPE_CHECKING:\n from studio.apps.identity.storage.models.accounts import User",
        'importlib.import_module("studio.apps.identity.storage.models.accounts")',
    ],
)
def test_private_storage_gate_rejects_each_import_form(source):
    assert foreign_storage(source, "studio.apps.video_editor.adapter")


def test_contracts_and_explicit_public_clients_remain_allowed():
    assert not foreign_storage(
        "from studio.contracts.identity.principal import StudioPrincipal\n"
        "from studio.apps.identity.clients.certification_records import CertificationReceiptFields",
        "studio.apps.video_editor.storage.service_models",
    )
    assert "studio.runtime.ids.new_id" in dependencies(
        "from studio.runtime.ids import new_id", "studio.apps.video_editor.storage.models"
    )


def test_metadata_discovery_is_not_a_storage_port():
    assert discovers_tables('Base.metadata.tables.get("other_app_tasks")')
    assert not discovers_tables("await source.describe(asset_ids)")


def test_applications_do_not_import_foreign_private_storage_or_discover_tables():
    violations = []
    for path in sorted(APPS.rglob("*.py")):
        module = ".".join(path.relative_to(APPS.parents[1]).with_suffix("").parts)
        module = module.removesuffix(".__init__")
        source = path.read_text()
        for target in sorted(foreign_storage(source, module, package=path.name == "__init__.py")):
            violations.append(f"{path.relative_to(APPS)} imports {target}")
        for target in dependencies(source, module, package=path.name == "__init__.py"):
            if target.startswith("studio.assembly.website."):
                violations.append(f"{path.relative_to(APPS)} depends on website composition")
        if discovers_tables(source):
            violations.append(f"{path.relative_to(APPS)} discovers tables outside a storage port")
    assert not violations, "\n".join(violations)
