"""Launch the dedicated Remote process with its read-only transport projection."""

import argparse
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from fpl_runtime.locking import service_lock
from fpl_runtime.migration_batches import MigrationPlan
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog

from .application import create_app
from .migration_application import create_export_app, create_import_app
from .migrations.registry import MIGRATIONS
from .settings import RemoteSettings


def main():
    parser = argparse.ArgumentParser(description="FPL Remote")
    parser.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--guacd-host", choices=("guacd", "127.0.0.1"), default="guacd")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--migration-plan", type=Path)
    parser.add_argument("--legacy-db", type=Path)
    options = parser.parse_args()
    if options.command.startswith("migration-"):
        if options.migration_plan is None or (
            (options.command == "migration-export") != (options.legacy_db is not None)
        ):
            parser.error("维护入口需要迁移计划，仅导出入口接受源快照")
        try:
            plan = MigrationPlan.read(options.migration_plan)
        except (ValueError, OSError):
            parser.error("迁移计划无法读取或格式无效")
        if options.legacy_db is not None:
            app = create_export_app(plan=plan, source_path=options.legacy_db)
        else:
            app = create_import_app(plan=plan, state_root=options.state_root)
        uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)
        return
    if options.migration_plan is not None or options.legacy_db is not None:
        parser.error("迁移计划与源快照仅用于维护入口")
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "remote", MIGRATIONS)
        return
    public_key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(public_key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    app = create_app(
        state_root=options.state_root,
        settings=RemoteSettings.read(options.config, guacd_host=options.guacd_host),
        public_key=public_key,
        credential=options.identity_token.read_text().strip(),
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
