"""Own the data lease for the entire development session, across Electron restarts."""

from __future__ import annotations

import argparse
import fcntl
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop/backend"))

from development_data import baseline_backup, check_data, offline_backup  # noqa: E402


def run() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--test-data-dir", type=Path)
    parser.add_argument("--test-port", type=int)
    args = parser.parse_args()
    if args.live and args.test_data_dir:
        parser.error("测试目录不能与正式数据模式一起使用")
    if args.test_port and (not args.test_data_dir or args.live):
        parser.error("调试端口只允许与隔离测试目录一起使用")
    data = args.test_data_dir or Path.home() / "Library/Application Support" / (
        "Future Props Lab" if args.live else "Future Props Lab Development"
    )
    data = data.resolve()
    data.mkdir(mode=0o700, parents=True, exist_ok=True)
    # The launcher lease prevents a second invocation from requesting another quit.
    with (data / "development.lock").open("a") as launch_lock:
        try:
            fcntl.flock(launch_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("这个数据目录已有开发窗口运行") from None
        with (data / "backend.lock").open("a") as data_lock:
            try:
                fcntl.flock(data_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if not args.live:
                    raise ValueError("数据目录正被使用，请先正常退出对应 App") from None
                print("正在请求正式 App 正常退出；未保存提示取消后将停止切换。", flush=True)
                subprocess.run(
                    [
                        "osascript",
                        "-e",
                        "with timeout of 20 seconds",
                        "-e",
                        'tell application "/Applications/Future Props Lab.app" to quit',
                        "-e",
                        "end timeout",
                    ],
                    timeout=25,
                    check=True,
                    capture_output=True,
                )
                for attempt in range(40):
                    try:
                        fcntl.flock(data_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if attempt == 39:
                            raise ValueError(
                                "App 尚未退出，已停止切换；保存后重新启动开发模式"
                            ) from None
                        time.sleep(0.25)
            check_data(data, args.live)
            if args.live:
                baseline_backup(data)
            previous = data / "development/last-success-config.toml"
            config = data / "backend/config.toml"
            if previous.exists() and previous.read_bytes() != config.read_bytes():
                print(
                    f"配置更新前备份已验证：{offline_backup(data, previous_config=True)}",
                    flush=True,
                )
            env = {**os.environ, "FPL_DEV_PARENT_PID": str(os.getpid())}
            child = subprocess.Popen(
                [
                    "node",
                    str(ROOT / "desktop/scripts/dev.cjs"),
                    "--data-dir",
                    str(data),
                    "--lock-fd",
                    str(data_lock.fileno()),
                    *(["--live"] if args.live else []),
                    *(["--test-port", str(args.test_port)] if args.test_port else []),
                ],
                cwd=ROOT,
                env=env,
                pass_fds=(data_lock.fileno(),),
            )
            # The Node supervisor handles terminal signals through the existing quit guard.
            signal.signal(signal.SIGINT, lambda *_: None)
            signal.signal(signal.SIGTERM, lambda *_: child.send_signal(signal.SIGTERM))
            return child.wait()


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as error:
        print(
            str(error) if isinstance(error, ValueError) else "开发启动失败；App 或配置尚未就绪",
            file=sys.stderr,
        )
        sys.exit(1)
