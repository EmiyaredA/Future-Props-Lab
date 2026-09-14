"""Private Electron child entrypoint. stdout is a handshake, stdin is its lifeline."""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import os
import socket
import sys
import threading
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import dotenv_values


def prepare_configuration(data_root: Path):
    from app.core.config import Settings

    root = data_root.resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    config_dir = root / "backend"
    config_dir.mkdir(exist_ok=True, mode=0o700)
    config_path = config_dir / ".env"
    database = root / "runtime" / "future-props.db"
    existing = dotenv_values(config_path) if config_path.exists() else {}
    if not existing.get("FPL_SECRETS_KEY"):
        if database.exists() or config_path.exists():
            raise ValueError("本地密钥缺失，请恢复 backend/.env；不会重建已有数据")
        key = Fernet.generate_key().decode("ascii")
        with config_path.open("x", encoding="utf-8") as stream:
            os.chmod(config_path, 0o600)
            stream.write(f"FPL_SECRETS_KEY={key}\n")
    values = dotenv_values(config_path)
    return Settings(
        _env_file=None,
        fpl_database_path=str(database),
        fpl_secrets_key=str(values["FPL_SECRETS_KEY"]),
        cors_origins="",
        fpl_auth_cookie_secure=False,
        **{
            name.lower(): value
            for name, value in values.items()
            if name.lower() in Settings.model_fields
            and name.lower()
            not in {
                "fpl_database_path",
                "fpl_secrets_key",
                "cors_origins",
                "fpl_auth_cookie_secure",
            }
            and value is not None
        },
    )


def launch() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, required=True)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Lock remains held until process exit, including during startup/migrations.
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

    configure_desktop(prepare_configuration(args.data_dir))
    import uvicorn

    from app.core.desktop import attach_desktop
    from app.main import app

    attach_desktop(app, token=token, web_root=args.web_dir.resolve())
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
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
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
