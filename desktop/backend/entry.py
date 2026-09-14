"""Private Electron child entrypoint. stdout is a handshake, stdin is its lifeline."""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import json
import os
import socket
import sys
import threading
from pathlib import Path

from cryptography.fernet import Fernet


def prepare_configuration(data_root: Path, loaded: dict | None = None):
    from app.core.config import Settings
    from fpl_config import read_config
    from fpl_config.migration import convert_legacy, encode, publish

    root = data_root.resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    config_dir = root / "backend"
    config_dir.mkdir(exist_ok=True, mode=0o700)
    config_path = config_dir / "config.toml"
    database = root / "runtime" / "future-props.db"
    if not config_path.exists() and (config_dir / ".env").exists():
        convert_legacy(config_path, Settings.validate_file_values, apply=True)
    if not config_path.exists():
        if database.exists() or list(config_dir.glob(".env.backup-*")):
            raise ValueError("本地密钥缺失，请恢复 backend/config.toml；不会重建已有数据")
        key = Fernet.generate_key().decode("ascii")
        publish(config_path, encode({"security": {"secrets_key": key}}))
    os.chmod(config_path, 0o600)
    snapshot = config_path.read_bytes()
    values = read_config(config_path)
    if config_path.read_bytes() != snapshot:
        raise ValueError("配置在加载期间变化，请重试")
    if not values.get("fpl_secrets_key"):
        raise ValueError("本地密钥缺失，请恢复 backend/config.toml；不会重建已有数据")
    values.update(fpl_database_path=str(database), cors_origins="", fpl_auth_cookie_secure=False)
    settings = Settings.validate_file_values(values)
    if loaded is not None:
        loaded["config_digest"] = hashlib.sha256(snapshot).hexdigest()
    return settings


def launch() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, required=True)
    if not getattr(sys, "frozen", False):
        parser.add_argument("--development-lock-fd", type=int)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Lock remains held until process exit, including during startup/migrations.
    inherited = getattr(args, "development_lock_fd", None)
    if inherited is not None:
        from development_data import check_data, verify_lease

        verify_lease(args.data_dir, inherited)
        check_data(args.data_dir)
        lock = os.fdopen(os.dup(inherited), "a")
    else:
        lock = (args.data_dir / "backend.lock").open("a")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    token = sys.stdin.buffer.readline(4096).strip().decode("ascii")
    if len(token) < 32:
        raise ValueError("缺少桌面启动凭据")
    # Do not inherit developer runtime/secrets from the calling shell.
    for name in list(os.environ):
        if name.startswith("FPL_") or name == "CORS_ORIGINS":
            os.environ.pop(name)
    from app.core.config import configure_desktop

    loaded = {} if inherited is not None else None
    configure_desktop(prepare_configuration(args.data_dir, loaded))
    import uvicorn

    from app.core.desktop import attach_desktop
    from app.main import app
    from app.routes.desktop_agent import configure_agent

    attach_desktop(
        app,
        token=token,
        web_root=None if inherited is not None else args.web_dir.resolve(),
        agent_policy=configure_agent(app),
    )
    if getattr(sys, "frozen", False):
        binaries = Path(sys._MEIPASS) / "bin"
        os.environ["PATH"] = str(binaries) + os.pathsep + "/usr/bin:/bin:/usr/sbin:/sbin"
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=0,
            workers=1,
            access_log=False,
            timeout_graceful_shutdown=10,
            log_level="warning",
        )
    )

    def watch_parent():
        sys.stdin.buffer.read()
        server.should_exit = True

        # Bound orphan lifetime even when startup or an extension is stuck.
        def force_exit():
            os._exit(1)

        timer = threading.Timer(15, force_exit)
        timer.daemon = True
        timer.start()

    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"port": sock.getsockname()[1], **(loaded or {})}), flush=True)
    asyncio.run(server.serve(sockets=[sock]))
    sock.close()
    lock.close()


if __name__ == "__main__":
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    try:
        if sys.argv[1:] == ["--self-test-resources"]:
            from resources import check_resources

            check_resources()
        else:
            launch()
    except Exception as exc:
        # Validation exceptions can include input secrets. Emit only controlled text.
        message = str(exc) if type(exc) is ValueError else "本地服务启动失败，请检查资源与配置"
        print(message, file=sys.stderr)
        sys.exit(1)
