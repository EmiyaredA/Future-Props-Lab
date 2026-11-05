"""Assets use cases do not load Visual's reference ORM or native/media runtimes."""

import os
import subprocess
import sys
from pathlib import Path

from studio.deployment.images import source_closure

ROOT = Path(__file__).resolve().parents[1]


def test_asset_use_cases_load_no_visual_orm_and_legacy_export_is_explicit():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
from studio.apps.asset_library.files import Files
from studio.assembly.independent.asset_library.application import create_app
from studio.apps.asset_library.storage.service_models import MODELS
assert not any(name.startswith("app.apps.") for name in sys.modules)
assert "studio.assembly.website.models" not in sys.modules
assert "studio.apps.identity.storage.models.accounts" not in sys.modules
from app.capabilities.asset_store.models import VisualProjectAssetReference
from studio.apps.visual_workshop.asset_references.models import VisualProjectAssetReference as owned
assert VisualProjectAssetReference is owned
assert owned not in MODELS
""",
        ],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT / "backend")},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_asset_production_entry_source_closure_excludes_other_owners():
    closure = source_closure(ROOT, "assets")
    assert "studio.apps.asset_library.files" in closure
    assert "studio.assembly.independent.asset_library.cli" in closure
    assert "studio.assembly.independent.asset_library.application" in closure
    assert "app.capabilities.asset_store.asset_outputs" in closure
    assert not any(
        name.startswith(
            ("app.apps.", "studio.apps.model_service.", "app.console.models", "studio.host")
        )
        for name in closure
    )
