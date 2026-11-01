"""Install/manage the per-user website LaunchAgent without storing credentials in plist."""

import argparse
import os
import plistlib
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LABEL = "cn.futurepropslab.website"


def definition(root=ROOT):
    python = root / ".venv/bin/python"
    if not python.is_file():
        raise ValueError("请先运行 npm run setup 安装运行环境")
    logs = root / ".runtime" / "logs"
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(python),
            str(root / "scripts/website/serve.py"),
        ],
        "WorkingDirectory": str(root),
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 30,
        "ExitTimeOut": 45,
        "EnvironmentVariables": {
            "PATH": os.environ.get("PATH", "/opt/homebrew/bin:/usr/bin:/bin"),
            "FPL_CONFIG_FILE": str(root / "backend/config.toml"),
            "UV_CACHE_DIR": str(root / ".local/uv-cache"),
        },
        "StandardOutPath": str(logs / "website.log"),
        "StandardErrorPath": str(logs / "website-error.log"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["install", "start", "stop", "status", "uninstall"])
    args = parser.parse_args()
    target = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    if args.action == "install":
        subprocess.run(
            [
                shutil.which("uv"),
                "run",
                "--no-sync",
                "python",
                str(ROOT / "scripts/website/serve.py"),
                "--check",
            ],
            cwd=ROOT,
            check=True,
        )
        if target.exists():
            raise SystemExit("网站服务已经安装；请使用 start/stop 管理")
        target.parent.mkdir(parents=True, exist_ok=True)
        (ROOT / ".runtime/logs").mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open("xb") as file:
            plistlib.dump(definition(), file)
        target.chmod(0o600)
        subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
    elif args.action == "start":
        loaded = subprocess.run(["launchctl", "print", service], capture_output=True)
        if loaded.returncode == 0:
            subprocess.run(["launchctl", "kickstart", service], check=True)
        else:
            subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
    elif args.action == "stop":
        subprocess.run(["launchctl", "bootout", service], check=True)
    elif args.action == "status":
        subprocess.run(["launchctl", "print", service], check=True)
    else:
        subprocess.run(["launchctl", "bootout", service], check=False)
        target.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
