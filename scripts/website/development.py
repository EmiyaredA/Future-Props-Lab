"""Own the fixed hot-reloading website pair and its existing live data lifecycle."""

import contextlib
import fcntl
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

if __package__ in {None, ""}:
    from frontend import uses_shared_frontend
else:
    from .frontend import uses_shared_frontend

ROOT = Path(__file__).resolve().parents[2]
WEB_URL = "http://127.0.0.1:3000"
API_URL = "http://127.0.0.1:9001"


def environment(root=ROOT):
    # Config, data and encryption key come exclusively from the existing TOML.
    # Never manufacture a second database or inherit a test/diagnostic override.
    values = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("FPL_") and name not in {"CORS_ORIGINS", "VITE_API_BASE"}
    }
    values.update(
        FPL_CONFIG_FILE=str(root / "backend/config.toml"),
        FPL_E2E_WEB_PORT="3000",
        FPL_E2E_API_PORT="9001",
        VITE_API_BASE="",
        PYTHONUNBUFFERED="1",
    )
    return values


def check_ports():
    for port in (3000, 9001):
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                raise RuntimeError(
                    f"固定端口 {port} 已被占用；请先停止旧服务，不会另选端口"
                ) from None


def wait_ready(child, *, timeout=90):
    deadline = time.monotonic() + timeout
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("后端启动失败；前端未启动，请查看上方错误")
        try:
            with opener.open(API_URL + "/ready", timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise RuntimeError("后端就绪超时；前端未启动")


def stop_children(children):
    # Ask parents to drain workers/tunnels, then remove any surviving descendants.
    for child in reversed(children):
        if child.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                child.terminate()
    deadline = time.monotonic() + 30
    for child in reversed(children):
        with contextlib.suppress(subprocess.TimeoutExpired):
            child.wait(timeout=max(0.1, deadline - time.monotonic()))
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGKILL)
        child.wait()


def run_pair(root=ROOT):
    check_ports()
    children = []

    def stop(_signal, _frame):
        raise KeyboardInterrupt

    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        env = environment(root)
        backend = subprocess.Popen(
            [sys.executable, str(root / "scripts/website/serve.py"), "--reload"],
            cwd=root,
            env=env,
            start_new_session=True,
        )
        children.append(backend)
        wait_ready(backend)
        config = root / "backend/config.toml"
        shared = config.is_file() and uses_shared_frontend(root)
        frontend = subprocess.Popen(
            [sys.executable, str(root / "scripts/website/frontend.py"), "--watch"]
            if shared
            else ["npm", "run", "dev", "--workspace", "web", "--", "--strictPort"],
            cwd=root,
            env=env,
            start_new_session=True,
        )
        children.append(frontend)
        print(f"唯一日常入口：{WEB_URL}；后端：{API_URL}；沿用 backend/config.toml", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.2)
        raise RuntimeError("前后端之一已退出，正在停止整套服务")
    finally:
        # A repeated shutdown signal must not interrupt cleanup.
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        stop_children(children)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main():
    state = ROOT / ".local/dev-server"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "launcher.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(f"统一服务已启动，请访问 {WEB_URL}；无需再次启动")
            return
        try:
            run_pair()
        except KeyboardInterrupt:
            pass
        except (RuntimeError, OSError) as exc:
            raise SystemExit(str(exc)) from None


if __name__ == "__main__":
    main()
