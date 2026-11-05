"""Maintain or run the stable Caddy gateway and its single control-plane process."""

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
from contextlib import nullcontext
from pathlib import Path

from studio.runtime.lifecycle.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL stable gateway")
    result.add_argument("command", choices=("serve", "migrate"))
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--caddyfile", type=Path, default=Path("/etc/caddy/Caddyfile"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    result.add_argument("--publishers", type=Path, default=Path("/run/fpl/publishers.json"))
    result.add_argument("--creative-bridge-ingress", type=Path)
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    result.add_argument("--port", type=int, default=8080)
    return result


def run(options):
    if not options.config.is_file():
        raise ValueError("缺少只读网关配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from studio.apps.gateway.storage.migrations.registry import MIGRATIONS
    from studio.config.settings import get_settings
    from studio.runtime.database.migrations import apply, check

    state = options.state_root.resolve()
    if get_settings().database_path != state / "service.db":
        raise ValueError("网关配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "gateway", MIGRATIONS)
            print("Gateway schema is current")
            return
        check(state / "service.db", "gateway", MIGRATIONS)
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from studio.apps.gateway.bridge_listener import serve_creative_bridge
        from studio.assembly.independent.gateway.application import create_app
        from studio.contracts.gateway.routing import RouteCatalog
        from studio.runtime.http.capability_client import CapabilityClient

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        catalog = RouteCatalog.read(options.catalog)
        credential = options.identity_token.read_text().strip()
        app = create_app(
            state_root=state,
            catalog=catalog,
            public_key=public,
            schema=json.loads(options.schema.read_text()),
            manifest=json.loads(
                Path("/app/backend/studio/contracts/gateway/automation_operations.json").read_text()
            ),
            capabilities=CapabilityClient(
                service="gateway",
                credential=credential,
                catalog=catalog,
            ),
            publishers=json.loads(options.publishers.read_text()),
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
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
        bridge = nullcontext(None)
        if options.creative_bridge_ingress is not None:
            from studio.contracts.creative_workshop.creative_transport import CREATIVE_SOCKET_DIR

            bridge = serve_creative_bridge(
                directory=CREATIVE_SOCKET_DIR,
                public_key=public,
                gateway_credential=credential,
                ingress_file=options.creative_bridge_ingress,
            )
        with bridge as bridge_worker:
            serve_caddy(options, app, uvicorn, bridge_worker)


def serve_caddy(options, app, uvicorn, bridge_worker):
    child = subprocess.Popen(
        ["/usr/bin/caddy", "run", "--config", str(options.caddyfile), "--adapter", "caddyfile"]
    )
    stopping = threading.Event()

    def observe():
        while not stopping.wait(0.2):
            if child.poll() is not None or (
                bridge_worker is not None and not bridge_worker.is_alive()
            ):
                os.kill(os.getpid(), signal.SIGTERM)
                return

    threading.Thread(target=observe, daemon=True).start()
    try:
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)
    finally:
        stopping.set()
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
