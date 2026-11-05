"""Start the installed Presentation service or explicitly initialize its state."""

import argparse
import os
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from studio.apps.presentation_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.presentation_workshop.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply
from studio.runtime.lifecycle.locking import service_lock


def main():
    parser = argparse.ArgumentParser(description="FPL Presentation")
    parser.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    parser.add_argument("--migration-plan", type=Path)
    parser.add_argument("--legacy-db", type=Path)
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument(
        "--archive-key", type=Path, default=Path("/run/fpl/presentation-archive-key")
    )
    options = parser.parse_args()
    if options.command.startswith("migration-"):
        if options.migration_plan is None or (
            (options.command == "migration-export") != (options.legacy_db is not None)
        ):
            parser.error("维护入口需要迁移计划，仅导出入口接受源快照")
        from studio.assembly.independent.presentation_workshop.maintenance import (
            create_export_app,
            create_import_app,
        )
        from studio.contracts.management.migration_batches import MigrationPlan

        try:
            plan = MigrationPlan.read(options.migration_plan)
        except (OSError, ValueError):
            parser.error("迁移计划无法读取或格式无效")
        if options.legacy_db is None:
            app = create_import_app(plan=plan, state_root=options.state_root)
        else:
            app = create_export_app(plan=plan, source_path=options.legacy_db)
        uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)
        return
    if options.migration_plan is not None or options.legacy_db is not None:
        parser.error("迁移计划和源快照仅供维护入口使用")
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "presentation", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    try:
        credential = options.identity_token.read_text().strip()
        if len(credential) < 32:
            raise ValueError
    except (OSError, ValueError):
        parser.error("Presentation Identity 凭据无法读取或无效")

    uploads = options.state_root.resolve() / ".http-uploads"
    if uploads.is_symlink():
        parser.error("演示工坊 HTTP 上传暂存目录不能是符号链接")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads)
    archive_key = options.archive_key.read_text().strip() if options.archive_key.is_file() else None
    if archive_key == credential:
        parser.error("演示归档对等凭据必须独立")
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        credential=credential,
        archive_key=archive_key,
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
