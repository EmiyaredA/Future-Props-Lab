"""Workbench integration runs in a fresh interpreter and an owned temporary database."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_independent_workbench_and_scoped_native_protocol(tmp_path):
    state = tmp_path / "agents"
    result = subprocess.run(
        [sys.executable, str(ROOT / "tests/agents_service_scenario.py")],
        cwd=ROOT,
        env={
            **os.environ,
            "AGENTS_TEST_ROOT": str(state),
            "FPL_DATABASE_PATH": str(state / "service.db"),
            "FPL_CONFIG_FILE": str(state / "absent.toml"),
            "PYTHONPATH": os.pathsep.join((str(ROOT / "backend"), str(ROOT))),
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
