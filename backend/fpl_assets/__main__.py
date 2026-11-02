"""Explicit owned migrations and installed Assets serving, without dotenv or secrets key."""

import argparse
import os
import sys
from pathlib import Path

from fpl_runtime.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Assets")
    result.add_argument("command", choices=("serve", "migrate"))
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument("--connection", type=Path, default=Path("/run/fpl/identity-client.json"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--web-root", type=Path, default=Path("/app/web"))
    result.add_argument("--port", type=int, default=8080)
    return result


def run(options):
    from fpl_runtime.migrations import apply, check

    from .migrations.registry import MIGRATIONS
    from .settings import load_settings

    if not options.config.is_file():
        raise ValueError("缺少只读 Assets 配置")
    settings = load_settings(options.config)
    state = options.state_root.resolve()
    if settings.database_path != state / "service.db":
        raise ValueError("Assets 配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "assets", MIGRATIONS)
            print("Assets schema is current")
            return
        check(state / "service.db", "assets", MIGRATIONS)
        import json

        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from fpl_runtime.capability_client import CapabilityClient
        from fpl_runtime.identity_client import LiveAuthorization
        from fpl_runtime.routing import RouteCatalog

        from .application import create_app

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        connection = json.loads(options.connection.read_text())
        if (
            set(connection) != {"credential"}
            or not isinstance(connection["credential"], str)
            or len(connection["credential"]) < 32
        ):
            raise ValueError("Assets 身份服务连接配置无效")
        catalog = RouteCatalog.read(options.catalog)
        credential = connection["credential"]
        identity = LiveAuthorization(service="assets", credential=credential)
        capabilities = CapabilityClient(service="assets", credential=credential, catalog=catalog)
        has_web = (options.web_root / "build.json").is_file()
        if not has_web and not (options.web_root / ".api-only").is_file():
            raise ValueError("Assets 缺少已安装的浏览器程序")
        app = create_app(
            settings=settings,
            catalog=catalog,
            public_key=public,
            identity=identity,
            capabilities=capabilities,
            web_root=options.web_root if has_web else None,
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
