"""Fresh-process management/Identity integration; no live deployment is read."""

import os
import subprocess
import sys
from pathlib import Path


def test_management_identity_and_native_boundary(tmp_path):
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [sys.executable, str(root / "tests/management_service_scenario.py")],
        cwd=root,
        env={
            **os.environ,
            "MANAGEMENT_TEST_ROOT": str(tmp_path),
            "PYTHONPATH": str(root / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
