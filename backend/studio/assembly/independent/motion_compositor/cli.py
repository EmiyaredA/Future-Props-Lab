"""Start the installed Motion service or explicitly initialize its state."""

import argparse
import os
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from studio.apps.motion_compositor.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.motion_compositor.application import create_app
from studio.assembly.independent.motion_compositor.maintenance import (
    create_export_app,
    create_import_app,
)
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.motion_compositor.motion_exports import load_export_key
from studio.runtime.database.migrations import apply
from studio.runtime.database.project_history_migration import (
    add_maintenance_options,
    handle_maintenance,
)
from studio.runtime.lifecycle.locking import service_lock


def main():
    parser = argparse.ArgumentParser(description="FPL Motion")
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
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--archive-key", type=Path, default=Path("/run/fpl/motion-archive-key"))
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument("--export-key", type=Path, default=Path("/run/fpl/motion-export-key"))
    add_maintenance_options(parser)
    options = parser.parse_args()
    if handle_maintenance(parser, options, create_export_app, create_import_app):
        return
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "motion", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    try:
        credential = options.identity_token.read_text().strip()
        if len(credential) < 32:
            raise ValueError
    except (OSError, ValueError):
        parser.error("Motion Identity 凭据无法读取或无效")

    uploads = options.state_root.resolve() / ".http-uploads"
    if uploads.is_symlink():
        parser.error("特效工坊上传暂存目录不能是符号链接")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads)
    archive_key = None
    if options.archive_key.is_file():
        if options.archive_key.is_symlink() or options.archive_key.stat().st_mode & 0o077:
            parser.error("特效归档对等凭据必须为受保护的普通文件")
        archive_key = options.archive_key.read_text().strip()
        if archive_key == credential:
            parser.error("特效归档对等凭据必须独立")
    try:
        export_key = load_export_key(
            options.export_key, identity_credential=credential, archive_key=archive_key
        )
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        credential=credential,
        archive_key=archive_key,
        export_key=export_key,
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
