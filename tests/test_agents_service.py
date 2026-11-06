"""Workbench integration runs in a fresh interpreter and an owned temporary database."""

import json
import os
import subprocess
import sys
from pathlib import Path

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]


def test_agents_migrate_loads_explicit_config_before_settings_import(tmp_path):
    state = tmp_path / "agents"
    config = tmp_path / "agents.toml"
    config.write_text(
        "[storage]\ndatabase_path = "
        + json.dumps(str(state / "service.db"))
        + "\n[security]\nsecrets_key = "
        + json.dumps(Fernet.generate_key().decode())
        + "\n"
    )
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "studio.assembly.independent.agent_workbench.cli",
            "migrate",
            "--config",
            str(config),
            "--state-root",
            str(state),
        ],
        cwd=ROOT,
        env={
            **{key: value for key, value in os.environ.items() if not key.startswith("FPL_")},
            "PYTHONPATH": str(ROOT / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (state / "service.db").is_file()
