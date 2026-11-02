"""Independent management container: its own ASGI lifecycle and Caddy ingress."""

import argparse
import json
import os
import signal
import subprocess
import threading
from pathlib import Path

from fpl_config import read_config
from fpl_runtime.locking import service_lock


def run():
    parser = argparse.ArgumentParser(description="FPL independent management service")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--caddyfile", type=Path, default=Path("/etc/caddy/Caddyfile"))
    parser.add_argument("--api-only", action="store_true")
    options = parser.parse_args()
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    values = read_config(options.config)
    state = options.state_root.resolve()
    if Path(values.get("fpl_database_path", "")).resolve() != state / "service.db":
        raise ValueError("管理端配置必须指向自有数据库")
    from fpl_runtime.migrations import apply, check

    from .migrations.registry import MIGRATIONS

    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "management", MIGRATIONS)
            print("Management schema is current")
            return
        check(state / "service.db", "management", MIGRATIONS)
        import uvicorn
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from fpl_runtime.identity_client import LiveAuthorization
        from fpl_runtime.routing import RouteCatalog

        from .application import create_app

        app = create_app(
            state_root=state,
            catalog=RouteCatalog.read(options.catalog),
            public_key=load_pem_public_key(Path("/run/fpl/identity-public.pem").read_bytes()),
            identity=LiveAuthorization(
                service="management", credential=Path("/run/fpl/identity-token").read_text().strip()
            ),
            native_ingress_token=Path("/run/fpl/native-ingress").read_text().strip(),
            workers=json.loads(Path("/run/fpl/workers.json").read_text()),
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
            web_root=Path("/app/web") if Path("/app/web/build.json").is_file() else None,
        )
        child = None
        stopping = threading.Event()
        if not options.api_only:
            subprocess.run(
                [
                    "/usr/bin/caddy",
                    "validate",
                    "--config",
                    str(options.caddyfile),
                    "--adapter",
                    "caddyfile",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            child = subprocess.Popen(
                [
                    "/usr/bin/caddy",
                    "run",
                    "--config",
                    str(options.caddyfile),
                    "--adapter",
                    "caddyfile",
                ]
            )

            def observe():
                child.wait()
                if not stopping.is_set():
                    os.kill(os.getpid(), signal.SIGTERM)

            threading.Thread(target=observe, daemon=True).start()
        try:
            uvicorn.run(app, host="0.0.0.0", port=8080, proxy_headers=False, access_log=False)
        finally:
            stopping.set()
            if child and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


if __name__ == "__main__":
    run()
