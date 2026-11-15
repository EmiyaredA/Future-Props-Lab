"""Manage the opt-in, AC-only Mac awake task independently of website lifecycle."""

import argparse
import fcntl
import os
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
# Retain the existing label so migration cannot leave two awake tasks registered.
LABEL = "com.futureprops.mac-host-awake"


def definition(root):
    runtime = root / ".runtime/host-awake"
    return {
        "Label": LABEL,
        "ProgramArguments": ["/usr/bin/caffeinate", "-s"],
        "WorkingDirectory": str(runtime),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 15,
        "ProcessType": "Background",
        "Umask": 0o077,
        "StandardOutPath": str(runtime / "logs/awake.stdout.log"),
        "StandardErrorPath": str(runtime / "logs/awake.stderr.log"),
    }


def launchctl(*args, check=True):
    return subprocess.run(["/bin/launchctl", *args], capture_output=True, text=True, check=check)


def write_definition(path, value):
    draft = path.with_suffix(".pending")
    with draft.open("wb") as handle:
        os.fchmod(handle.fileno(), 0o600)
        plistlib.dump(value, handle)
    draft.replace(path)


def verify_running(service, expected):
    for _ in range(20):
        result = launchctl("print", service, check=False)
        if result.returncode == 0 and "\tstate = running\n" in result.stdout:
            fields = {
                "working directory": expected["WorkingDirectory"],
                "stdout path": expected["StandardOutPath"],
                "stderr path": expected["StandardErrorPath"],
                "program": expected["ProgramArguments"][0],
            }
            arguments = (
                "\targuments = {\n"
                + "".join(f"\t\t{arg}\n" for arg in expected["ProgramArguments"])
                + "\t}\n"
            )
            if arguments in result.stdout and all(
                f"\t{key} = {value}\n" in result.stdout for key, value in fields.items()
            ):
                return result.stdout
            raise RuntimeError("已加载的防休眠任务路径与 FPL 定义不一致")
        time.sleep(0.25)
    raise RuntimeError("防休眠任务未进入 running 状态")


def bootstrap(domain, target):
    # launchd can briefly retain a registration after bootout acknowledges it.
    for _ in range(20):
        result = launchctl("bootstrap", domain, str(target), check=False)
        if result.returncode == 0:
            return
        time.sleep(0.25)
    raise RuntimeError(f"防休眠任务加载失败：{result.stderr.strip()}")


def install(root, target, domain):
    expected = definition(root)
    runtime = root / ".runtime/host-awake"
    registered = runtime / "launchagent.plist"
    service = f"{domain}/{LABEL}"
    previous = plistlib.loads(target.read_bytes()) if target.exists() else None
    if previous is not None and previous != expected:
        if (
            previous.get("Label") != LABEL
            or previous.get("ProgramArguments") != expected["ProgramArguments"]
            or previous.get("WorkingDirectory") != str(root.parent / "remote-control")
        ):
            raise ValueError("同名任务不属于本 FPL 或相邻 remote-control，拒绝覆盖")
    loaded = launchctl("print", service, check=False).returncode == 0
    if loaded and previous is None:
        raise ValueError("同名任务已加载但缺少原启动定义，拒绝无法回退的接管")
    if previous == expected and loaded:
        verify_running(service, expected)
        return
    backup = runtime / "rollback" / uuid4().hex
    backup.mkdir(parents=True, mode=0o700)
    for path in (target, registered):
        if path.exists():
            shutil.copy2(path, backup / path.name)
    (runtime / "logs").mkdir(exist_ok=True, mode=0o700)
    target.parent.mkdir(parents=True, exist_ok=True)
    write_definition(registered, expected)
    subprocess.run(["/usr/bin/plutil", "-lint", str(registered)], check=True)
    try:
        if loaded:
            launchctl("bootout", service)
        write_definition(target, expected)
        bootstrap(domain, target)
        verify_running(service, expected)
    except Exception:
        launchctl("bootout", service, check=False)
        for path in (target, registered):
            original = backup / path.name
            if original.exists():
                shutil.copy2(original, path)
            else:
                path.unlink(missing_ok=True)
        if loaded:
            bootstrap(domain, target)
            verify_running(service, previous)
        raise
    print(f"防休眠已由 FPL 管理；原启动配置：{backup}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "start", "stop", "status"))
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("仅适用于 macOS 登录用户会话")
    runtime = ROOT / ".runtime/host-awake"
    target = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    if args.action == "status":
        result = launchctl("print", service, check=False)
        print(result.stdout or result.stderr, end="")
        raise SystemExit(result.returncode)
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (runtime / "control.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if target.is_symlink():
            raise ValueError("防休眠启动定义不能是符号链接")
        if args.action == "install":
            install(ROOT, target, domain)
        else:
            expected = definition(ROOT)
            if not target.exists() or plistlib.loads(target.read_bytes()) != expected:
                raise ValueError("请先 install 安装本 FPL 的防休眠任务")
            loaded = launchctl("print", service, check=False).returncode == 0
            if args.action == "stop" and loaded:
                launchctl("bootout", service)
            elif args.action == "start":
                if not loaded:
                    bootstrap(domain, target)
                verify_running(service, expected)


if __name__ == "__main__":
    main()
