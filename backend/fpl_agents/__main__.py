"""Explicit maintenance and serving of the independently owned Agents database."""

import argparse
import json
import os
import sys
from pathlib import Path

from fpl_runtime.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Agents service")
    result.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    result.add_argument("--migration-plan", type=Path)
    result.add_argument("--legacy-db", type=Path)
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    result.add_argument(
        "--native-ingress-token", type=Path, default=Path("/run/fpl/native-ingress")
    )
    result.add_argument("--workers", type=Path, default=Path("/run/fpl/workers.json"))
    result.add_argument(
        "--execution-workers", type=Path, default=Path("/run/fpl/execution-workers.json")
    )
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--identity-url", default="http://identity:8080")
    result.add_argument("--web-root", type=Path, default=Path("/app/web"))
    result.add_argument("--port", type=int, default=8080)
    return result


def run(options):
    if not options.config.is_file():
        raise ValueError("缺少只读服务配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from app.runtime.config import get_settings
    from fpl_runtime.migrations import apply, check

    from .migrations.registry import MIGRATIONS

    state = options.state_root.resolve()
    if get_settings().database_path != state / "service.db":
        raise ValueError("工作台配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "agents", MIGRATIONS)
            print("Agents schema is current")
            return
        check(state / "service.db", "agents", MIGRATIONS)
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from fpl_runtime.identity_client import LiveAuthorization
        from fpl_runtime.routing import RouteCatalog

        from .application import create_app

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        identity_token = options.identity_token.read_text().strip()
        execution_workers = (
            json.loads(options.execution_workers.read_text())
            if options.execution_workers.is_file()
            else {}
        )
        if identity_token in execution_workers.values():
            raise ValueError("工作台执行必须使用独立身份凭据")
        app = create_app(
            state_root=state,
            catalog=RouteCatalog.read(options.catalog),
            public_key=public,
            identity=LiveAuthorization(
                service="agents",
                credential=identity_token,
                base_url=options.identity_url,
            ),
            native_ingress_token=options.native_ingress_token.read_text().strip(),
            workers=json.loads(options.workers.read_text()),
            execution_workers=execution_workers,
            web_root=options.web_root if (options.web_root / "build.json").is_file() else None,
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        from fpl_runtime.project_history_migration import handle_maintenance

        from .migration_application import create_export_app, create_import_app

        arguments = parser()
        options = arguments.parse_args()
        if not handle_maintenance(arguments, options, create_export_app, create_import_app):
            run(options)
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
