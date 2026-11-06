"""Real private delegation and HTTP input copying use isolated service-owned storage."""

import os
import subprocess
import sys
from pathlib import Path


def test_model_library_input_uses_identity_assets_and_owned_models(tmp_path):
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [sys.executable, str(root / "tests/model_library_input_scenario.py")],
        cwd=root,
        env={
            **os.environ,
            "MODEL_LIBRARY_INPUT_ROOT": str(tmp_path),
            "FPL_DATABASE_PATH": str(tmp_path / "identity/service.db"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "PYTHONPATH": str(root / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
