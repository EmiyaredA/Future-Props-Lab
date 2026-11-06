"""Catalogue endpoint contracts are reusable outside the recovery website."""

import os
import subprocess
import sys
from pathlib import Path


def test_catalogue_http_uses_owned_bindings_without_account_or_workshop_tables(tmp_path):
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [sys.executable, str(root / "tests/model_catalog_http_scenario.py")],
        cwd=root,
        env={
            **os.environ,
            "CATALOG_TEST_ROOT": str(tmp_path),
            "PYTHONPATH": str(root / "backend"),
            "FPL_SECRETS_KEY": "",
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
        },
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
