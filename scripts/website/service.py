"""Install/manage the per-user website LaunchAgent without storing credentials in plist."""

import argparse
import os
import plistlib
import shutil
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LABEL = "cn.futurepropslab.website"
MANAGEMENT_LABEL = "cn.futurepropslab.management"
ACTIVE_LAUNCH = Path(".local/studio-ops/active-launch.plist")


def definition(root=ROOT):
    python = root / ".venv/bin/python"
    if not python.is_file():
        raise ValueError("请先运行 npm run setup 安装运行环境")
    logs = root / ".runtime" / "logs"
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(python),
            str(root / "scripts/website/development.py"),
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


def registered_definition(root):
    path = root / ACTIVE_LAUNCH
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise SystemExit("Studio 启动登记必须是当前用户拥有的 0600 普通文件")
    value = plistlib.loads(path.read_bytes())
    args = value.get("ProgramArguments", [])
    directory = Path(value.get("WorkingDirectory", ""))
    label = value.get("Label")
    prefixes = {
        LABEL: [str(directory / "scripts/website/serve.py"), "--reload", "--config"],
        MANAGEMENT_LABEL: [str(directory / "scripts/management/start.py"), "--config"],
    }
    if (
        label not in prefixes
        or not directory.is_absolute()
        or not directory.resolve().is_relative_to(root)
        or args[1:-1] != prefixes[label]
        or not Path(args[0]).is_absolute()
        or not Path(args[0]).parent.resolve().is_relative_to(root)
        or not Path(args[-1]).is_absolute()
        or not Path(args[-1]).resolve().is_relative_to(root)
        or label == MANAGEMENT_LABEL
        and Path(args[-1]) != root / "backend/config.toml"
        or not all(Path(args[index]).is_file() for index in (0, 1, -1))
    ):
        raise SystemExit("Studio 启动登记与本项目的运行目录不匹配")
    return value


def check_loaded_definition(status, expected):
    lines = status.splitlines()
    try:
        begin = lines.index("\targuments = {") + 1
        end = lines.index("\t}", begin)
        arguments = [line.strip() for line in lines[begin:end]]
    except ValueError:
        arguments = []
    if arguments != expected["ProgramArguments"] or (
        "\tworking directory = " + expected["WorkingDirectory"] not in lines
    ):
        raise SystemExit("当前后台与已登记的 Studio 启动路径不一致，请检查 status")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["install", "start", "stop", "status", "uninstall"])
    args = parser.parse_args()
    registered = registered_definition(ROOT)
    label = registered["Label"] if registered else LABEL
    target = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{label}"
    if args.action in {"start", "install"}:
        other = LABEL if label == MANAGEMENT_LABEL else MANAGEMENT_LABEL
        conflict = subprocess.run(["launchctl", "print", f"{domain}/{other}"], capture_output=True)
        if conflict.returncode == 0:
            raise SystemExit("另一套 Studio 后台仍在运行，请先完成切换")
    if args.action == "install":
        expected = registered or definition()
        loaded = subprocess.run(["launchctl", "print", service], capture_output=True)
        if loaded.returncode == 0:
            raise SystemExit("请先停止现有服务，再 install 更新统一启动入口")
        if target.exists():
            installed = plistlib.loads(target.read_bytes())
            if installed.get("WorkingDirectory") not in {str(ROOT), expected["WorkingDirectory"]}:
                raise SystemExit("同名服务属于其他目录，拒绝覆盖")
        check_command = (
            [*registered["ProgramArguments"], "--check"]
            if registered
            else [
                shutil.which("uv"),
                "run",
                "--no-sync",
                "python",
                str(ROOT / "scripts/website/serve.py"),
                "--check",
                "--reload",
            ]
        )
        subprocess.run(
            check_command,
            cwd=expected["WorkingDirectory"],
            env={**os.environ, **expected.get("EnvironmentVariables", {})},
            check=True,
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        (ROOT / ".runtime/logs").mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open("wb") as file:
            plistlib.dump(expected, file)
        target.chmod(0o600)
        subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
    elif args.action == "start":
        expected = registered or definition()
        installed = plistlib.loads(target.read_bytes()) if target.is_file() else {}
        fields = ("Label", "ProgramArguments", "WorkingDirectory")
        if (registered is not None and installed != registered) or any(
            installed.get(field) != expected[field] for field in fields
        ):
            raise SystemExit("请先停止旧服务并运行 install 更新统一启动入口")
        loaded = subprocess.run(["launchctl", "print", service], capture_output=True, text=True)
        if loaded.returncode == 0:
            check_loaded_definition(loaded.stdout, expected)
            if "\tstate = running" in loaded.stdout.splitlines():
                print("Studio 已在运行")
                return
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
