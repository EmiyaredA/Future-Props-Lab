"""The stable gateway never loads Portal or application storage."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_independent_gateway_business_contract(tmp_path):
    root = tmp_path / "gateway"
    response = subprocess.run(
        [sys.executable, str(ROOT / "tests/gateway_service_scenario.py")],
        cwd=ROOT,
        env={
            **os.environ,
            "GATEWAY_TEST_ROOT": str(root),
            "FPL_DATABASE_PATH": str(root / "service.db"),
            "FPL_CONFIG_FILE": str(root / "absent.toml"),
            "PYTHONPATH": str(ROOT / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert response.returncode == 0, response.stdout + response.stderr
