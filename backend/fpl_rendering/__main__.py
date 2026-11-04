"""Explicit Rendering storage migrations and bounded HTTP serving."""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from fpl_runtime.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Rendering")
    result.add_argument("command", choices=("serve", "migrate"))
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--connection", type=Path, default=Path("/run/fpl/identity-client.json"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--export-key", type=Path, default=Path("/run/fpl/motion-export-key"))
    result.add_argument("--port", type=int, default=8080)
    return result


def run(options):
    from fpl_runtime.migrations import apply, check

    from .migrations.registry import MIGRATIONS
    from .settings import load_settings

    if not options.config.is_file():
        raise ValueError("缺少只读 Rendering 配置")
    settings = load_settings(options.config)
    state = options.state_root.resolve()
    if settings.database_path != state / "service.db":
        raise ValueError("Rendering 配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "rendering", MIGRATIONS)
            print("Rendering schema is current")
            return
        check(state / "service.db", "rendering", MIGRATIONS)
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from fpl_runtime.capability_client import CapabilityClient
        from fpl_runtime.identity_client import LiveAuthorization
        from fpl_runtime.motion_exports import load_export_key
        from fpl_runtime.routing import RouteCatalog

        from .application import create_app

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        if options.connection.is_symlink() or options.connection.stat().st_mode & 0o077:
            raise ValueError("Rendering 服务凭据需要受保护配置")
        values = json.loads(options.connection.read_text())
        if (
            set(values) != {"credential"}
            or not isinstance(values["credential"], str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", values["credential"])
        ):
            raise ValueError("Rendering 身份服务连接配置无效")
        credential = values["credential"]
        catalog = RouteCatalog.read(options.catalog)
        app = create_app(
            settings=settings,
            catalog=catalog,
            public_key=public,
            identity=LiveAuthorization(service="rendering", credential=credential),
            capabilities=CapabilityClient(
                service="rendering", credential=credential, catalog=catalog
            ),
            export_key=load_export_key(options.export_key, identity_credential=credential),
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
