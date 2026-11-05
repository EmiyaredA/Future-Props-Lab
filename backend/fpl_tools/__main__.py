"""Start the owned Tools API or explicitly initialize its SQLite state."""

import argparse
import os
import stat
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from pydantic import ValidationError

from fpl_runtime.locking import service_lock
from fpl_runtime.migration_batches import MigrationPlan
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog
from fpl_runtime.tools_native import ToolsNativeOptions

from .application import create_app
from .migration_application import create_export_app, create_import_app
from .migrations.registry import MIGRATIONS


def main():
    parser = argparse.ArgumentParser(description="FPL Tools")
    parser.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--native-config", type=Path)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--migration-plan", type=Path)
    parser.add_argument("--legacy-db", type=Path)
    options = parser.parse_args()
    if options.command.startswith("migration-"):
        if options.migration_plan is None:
            parser.error("迁移维护入口需要 --migration-plan")
        if (options.command == "migration-export") != (options.legacy_db is not None):
            parser.error("仅导出入口需要并接受 --legacy-db")
        try:
            plan = MigrationPlan.read(options.migration_plan)
        except (OSError, ValueError):
            parser.error("迁移计划无法读取或格式无效")
        if options.legacy_db is not None:
            try:
                app = create_export_app(plan=plan, source_path=options.legacy_db)
            except (OSError, ValueError) as exc:
                parser.error(str(exc))
        else:
            app = create_import_app(plan=plan, state_root=options.state_root)
        uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)
        return
    if options.migration_plan is not None or options.legacy_db is not None:
        parser.error("迁移计划与源快照仅适用于迁移维护入口")
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "tools", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    native = None
    if options.native_config is not None:
        info = options.native_config.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            parser.error("Tools 原生配置必须为本用户独占的普通文件")
        try:
            native = ToolsNativeOptions.model_validate_json(options.native_config.read_text())
        except ValidationError:
            parser.error("Tools 原生配置无效")
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        catalog=RouteCatalog.read(options.catalog),
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
        schema_path=options.schema,
        native_options=native,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
