"""Portal authorization and independent source closure run in a fresh process."""

import os
import subprocess
import sys
from pathlib import Path

from studio.deployment.images import source_closure

ROOT = Path(__file__).resolve().parents[1]


def test_portal_isolated_business_contract(tmp_path):
    root = tmp_path / "portal"
    result = subprocess.run(
        [sys.executable, str(ROOT / "tests/portal_service_scenario.py")],
        cwd=ROOT,
        env={
            **os.environ,
            "PORTAL_TEST_ROOT": str(root),
            "FPL_DATABASE_PATH": str(root / "service.db"),
            "FPL_CONFIG_FILE": str(root / "absent.toml"),
            "PYTHONPATH": str(ROOT / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_portal_source_closure_does_not_package_account_or_workshop_implementations():
    closure = source_closure(ROOT, "portal")
    assert "studio.assembly.independent.portal.application" in closure
    assert "app.console.governance.developer_docs" in closure
    assert not any(
        name.startswith(
            (
                "app.apps.",
                "app.console.models",
                "app.llm.",
                "studio.apps.identity",
                "studio.apps.agent_workbench",
                "studio.host",
            )
        )
        for name in closure
    )


def test_portal_maintenance_needs_no_encryption_secret_and_rejects_foreign_config(tmp_path):
    config = tmp_path / "portal.toml"
    state = tmp_path / "state"
    config.write_text('[storage]\ndatabase_path = "' + str(state / "service.db") + '"\n')
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"FPL_DATABASE_PATH", "FPL_SECRETS_KEY"}
    }
    environment["PYTHONPATH"] = str(ROOT / "backend")
    command = [
        sys.executable,
        "-m",
        "studio.assembly.independent.portal.cli",
        "migrate",
        "--config",
        str(config),
        "--state-root",
        str(state),
    ]
    result = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (state / "service.db").is_file()
    config.write_text(config.read_text() + '[security]\nsecrets_key = "not-needed"\n')
    rejected = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, text=True)
    assert rejected.returncode == 1 and "不属于此服务" in rejected.stderr
    assert "not-needed" not in rejected.stderr
