"""Assets use cases do not load Visual's reference ORM or native/media runtimes."""

import os
import subprocess
import sys
from pathlib import Path

from fpl_deployment.images import source_closure

ROOT = Path(__file__).resolve().parents[1]


def test_asset_use_cases_load_no_visual_orm_and_legacy_export_is_explicit():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
from fpl_assets.files import Files
from fpl_assets.application import create_app
from fpl_assets.models import MODELS
assert not any(name.startswith("app.apps.") for name in sys.modules)
assert "app.orm" not in sys.modules
assert "app.console.models.accounts" not in sys.modules
from app.capabilities.asset_store.models import VisualProjectAssetReference
from app.apps.visual_workshop.asset_references.models import VisualProjectAssetReference as owned
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
    assert "fpl_assets.files" in closure
    assert "fpl_assets.__main__" in closure
    assert "fpl_assets.application" in closure
    assert "app.capabilities.asset_store.asset_outputs" in closure
    assert not any(
        name.startswith(("app.apps.", "app.llm.", "app.console.models", "fpl_host"))
        for name in closure
    )
