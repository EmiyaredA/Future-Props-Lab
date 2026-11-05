"""Integration work cannot outlive its exact original account grant or change input."""

import os
import subprocess
import sys


def test_identity_integration_intents_are_inert_bound_and_live_checked(tmp_path):
    environment = {
        **os.environ,
        "PYTHONPATH": "backend:.",
        "INTEGRATION_INTENT_ROOT": str(tmp_path),
        "FPL_DATABASE_PATH": str(tmp_path / "service.db"),
        "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
    }
    result = subprocess.run(
        [sys.executable, "tests/integration_intent_scenario.py"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
