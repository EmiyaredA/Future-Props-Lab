"""Validate Identity in a fresh interpreter, outside monolith metadata and runners."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_identity_runs_with_only_owned_tables_and_no_portal(tmp_path):
    state = tmp_path / "identity"
    environment = {
        **os.environ,
        "IDENTITY_TEST_ROOT": str(state),
        "FPL_DATABASE_PATH": str(state / "service.db"),
        "FPL_CONFIG_FILE": str(state / "absent-config.toml"),
        "PYTHONPATH": str(ROOT / "backend"),
    }
    result = subprocess.run(
        [sys.executable, str(ROOT / "tests/identity_service_scenario.py")],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
