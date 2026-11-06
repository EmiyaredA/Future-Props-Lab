"""The website login command prepares private credentials before deployment enablement."""

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/website/codex_login.py"


@pytest.mark.parametrize("scenario", ["disabled", "missing", "unsafe_profile"])
def test_codex_login_preflight(tmp_path, scenario):
    root = tmp_path.resolve()
    executable = root / "codex"
    if scenario != "missing":
        executable.write_text(
            f"#!{sys.executable}\n"
            "import os, sys\n"
            "from pathlib import Path\n"
            "assert sys.argv[1:] == ['-c', 'cli_auth_credentials_store=\"file\"', 'login']\n"
            "assert Path.cwd().name.startswith('fpl-codex-login-')\n"
            "with open(os.open(Path(os.environ['CODEX_HOME']) / 'auth.json', "
            "os.O_CREAT | os.O_WRONLY, 0o600), 'w') as auth:\n"
            "    auth.write('{}')\n"
        )
        executable.chmod(0o700)

    profile = root / "profiles/codex-app-server"
    if scenario == "unsafe_profile":
        profile.mkdir(parents=True)
        profile.chmod(0o755)
    config = root / "config.toml"
    original = (
        f"[code_agents]\ncodex_enabled = false\ncodex_executable = {json.dumps(str(executable))}\n"
    )
    config.write_text(original)
    database = root / "isolated.db"
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=root,
        env={**os.environ, "FPL_CONFIG_FILE": str(config), "FPL_DATABASE_PATH": str(database)},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert config.read_text() == original
    assert not database.exists()
    auth = profile / "auth.json"
    if scenario == "disabled":
        assert result.returncode == 0, result.stderr
        assert auth.read_text() == "{}"
        assert stat.S_IMODE(profile.stat().st_mode) == 0o700
        assert stat.S_IMODE(auth.stat().st_mode) == 0o600
    else:
        assert result.returncode != 0
        expected = "未找到可执行的 Codex CLI" if scenario == "missing" else "权限不安全"
        assert expected in result.stderr
        assert not auth.exists()
