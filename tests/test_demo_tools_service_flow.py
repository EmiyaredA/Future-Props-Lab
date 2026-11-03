"""Cross-service demo tools exercise real Identity, Models and Integrations protocols."""

import os
import subprocess
import sys

from cryptography.fernet import Fernet


def test_fixed_demo_tools_install_recovers_lost_reply_and_validates_through_models(tmp_path):
    environment = {
        **os.environ,
        "PYTHONPATH": "backend:.",
        "DEMO_TOOLS_ROOT": str(tmp_path),
        "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
        "FPL_DATABASE_PATH": str(tmp_path / "identity/service.db"),
        "FPL_SECRETS_KEY": Fernet.generate_key().decode(),
    }
    result = subprocess.run(
        [sys.executable, "tests/demo_tools_scenario.py"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
