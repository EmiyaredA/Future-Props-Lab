"""Authorize the configured FPL Codex connection from the Mac terminal."""

import argparse
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.capabilities.agents.cli.catalog import connection  # noqa: E402
from app.capabilities.agents.cli.codex_profile import (  # noqa: E402
    AUTH_ARGS,
    profile_environment,
    profile_path,
)
from app.capabilities.agents.cli.transport import CliError  # noqa: E402
from app.runtime.config import get_cloud_settings  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device-auth", action="store_true")
    args = parser.parse_args()
    settings = get_cloud_settings()
    enabled, executable, message = connection(settings, "codex")
    if not enabled or not executable:
        raise SystemExit(message or "请先在部署配置中指定 Codex CLI")
    profile = profile_path(settings.runtime_path)
    if profile != profile.resolve():
        raise SystemExit("FPL Codex 专用目录不能经过符号链接")
    profile.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        env = profile_environment(profile, require_auth=False)
    except CliError as error:
        raise SystemExit(str(error)) from None
    with TemporaryDirectory(prefix="fpl-codex-login-") as work:
        result = subprocess.run(
            [executable, *AUTH_ARGS, "login", *(["--device-auth"] if args.device_auth else [])],
            cwd=work,
            env=env,
            check=False,
        )
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
