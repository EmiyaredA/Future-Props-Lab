"""Real Identity HTTP revocations stop queued jobs in an independently owned Models DB."""

import os
import subprocess
import sys
from pathlib import Path


def test_model_execution_rechecks_logout_account_disable_and_key_revoke(tmp_path):
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, str(root / "tests/model_execution_identity_scenario.py")],
        cwd=root,
        env={
            **os.environ,
            "MODEL_EXECUTION_IDENTITY_ROOT": str(tmp_path),
            "FPL_DATABASE_PATH": str(tmp_path / "identity/service.db"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "PYTHONPATH": str(root / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
