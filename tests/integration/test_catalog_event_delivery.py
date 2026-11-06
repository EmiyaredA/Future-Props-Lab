"""Identity and Models use their owned HTTP/use-case boundaries in a fresh interpreter."""

import os
import subprocess
import sys
from pathlib import Path


def test_catalog_event_delivery_survives_role_changes_and_lost_acknowledgments(tmp_path):
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, str(root / "tests/catalog_event_delivery_scenario.py")],
        cwd=root,
        env={
            **os.environ,
            "CATALOG_DELIVERY_TEST_ROOT": str(tmp_path),
            "FPL_DATABASE_PATH": str(tmp_path / "identity/service.db"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "PYTHONPATH": str(root / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
