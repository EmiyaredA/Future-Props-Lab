"""Per-user management LaunchAgent; never installs over an active legacy supervisor."""

import argparse
import os
import plistlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LABEL = "cn.futurepropslab.management"


def definition(root=ROOT):
    python = root / ".venv/bin/python"
    if not python.is_file():
        raise ValueError("请先运行 npm run setup")
    return {
        "Label": LABEL,
        "ProgramArguments": [str(python), str(root / "scripts/management/start.py")],
        "WorkingDirectory": str(root),
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 30,
        "ExitTimeOut": 45,
        "EnvironmentVariables": {"PATH": os.environ.get("PATH", "/opt/homebrew/bin:/usr/bin:/bin")},
        "StandardOutPath": str(root / ".runtime/logs/management-host.log"),
        "StandardErrorPath": str(root / ".runtime/logs/management-host-error.log"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install", "start", "stop", "status", "uninstall"))
    options = parser.parse_args()
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    target = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    if options.action in {"install", "start"}:
        legacy = subprocess.run(
            ["launchctl", "print", f"{domain}/cn.futurepropslab.website"], capture_output=True
        )
        if legacy.returncode == 0:
            raise SystemExit(
                "旧网站服务仍已加载；请先按正式停机流程停止并卸载旧启动器，避免双重管理"
            )
    if options.action == "install":
        subprocess.run(
            [str(ROOT / ".venv/bin/python"), str(ROOT / "scripts/management/start.py"), "--check"],
            check=True,
            cwd=ROOT,
        )
        if target.exists():
            current = plistlib.loads(target.read_bytes())
            if current.get("WorkingDirectory") != str(ROOT):
                raise SystemExit("同名服务属于其他目录，拒绝覆盖")
            if subprocess.run(["launchctl", "print", service], capture_output=True).returncode == 0:
                raise SystemExit("请先停止现有管理 worker 再更新安装")
        target.parent.mkdir(parents=True, exist_ok=True)
        (ROOT / ".runtime/logs").mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open("wb") as handle:
            plistlib.dump(definition(), handle)
        target.chmod(0o600)
        subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
    elif options.action == "start":
        if not target.is_file() or plistlib.loads(target.read_bytes()) != definition():
            raise SystemExit("请先 install 安装当前管理启动器")
        subprocess.run(["launchctl", "kickstart", service], check=True)
    elif options.action == "stop":
        subprocess.run(["launchctl", "bootout", service], check=True)
    elif options.action == "status":
        subprocess.run(["launchctl", "print", service], check=False)
    else:
        subprocess.run(["launchctl", "bootout", service], check=False, capture_output=True)
        target.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
