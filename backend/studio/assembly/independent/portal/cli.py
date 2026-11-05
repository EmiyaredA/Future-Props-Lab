"""Explicit Portal migrations and installed program serving, never login-time builds."""

import argparse
import os
import sys
from pathlib import Path

from studio.runtime.lifecycle.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Portal")
    result.add_argument("command", choices=("serve", "migrate"))
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--web-root", type=Path, default=Path("/app/web"))
    result.add_argument("--port", type=int, default=8080)
    return result


def run(options):
    if not options.config.is_file():
        raise ValueError("缺少只读门户配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from studio.apps.portal.storage.migrations.registry import MIGRATIONS
    from studio.config import REPO_ROOT, read_config
    from studio.runtime.database.migrations import apply, check

    state = options.state_root.resolve()
    fields = read_config(options.config)
    if set(fields) - {"fpl_database_path"}:
        raise ValueError("门户配置包含不属于此服务的字段")
    configured = os.environ.get("FPL_DATABASE_PATH", fields.get("fpl_database_path", ""))
    if not configured:
        raise ValueError("缺少门户数据库路径")
    target = Path(configured).expanduser()
    target = target if target.is_absolute() else REPO_ROOT / target
    if target.resolve() != state / "service.db":
        raise ValueError("门户配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "portal", MIGRATIONS)
            print("Portal schema is current")
            return
        check(state / "service.db", "portal", MIGRATIONS)
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from studio.assembly.independent.portal.application import create_app
        from studio.contracts.gateway.routing import RouteCatalog

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        if not (options.web_root / "build.json").is_file():
            raise ValueError("门户必须包含已安装的浏览器程序")
        app = create_app(
            state_root=state,
            catalog=RouteCatalog.read(options.catalog),
            public_key=public,
            web_root=options.web_root,
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
