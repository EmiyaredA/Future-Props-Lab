"""Explicit Rendering storage migrations and bounded HTTP serving."""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from studio.runtime.lifecycle.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Rendering")
    result.add_argument("command", choices=("serve", "migrate", "migration-import"))
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--connection", type=Path, default=Path("/run/fpl/identity-client.json"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--export-key", type=Path, default=Path("/run/fpl/motion-export-key"))
    result.add_argument("--video-media-key", type=Path, default=Path("/run/fpl/video-media-key"))
    result.add_argument(
        "--video-originals-key", type=Path, default=Path("/run/fpl/video-originals-key")
    )
    result.add_argument("--port", type=int, default=8080)
    result.add_argument("--migration-plan", type=Path)
    return result


def run(options):
    from studio.apps.media_rendering.settings import load_settings
    from studio.apps.media_rendering.storage.migrations.registry import MIGRATIONS
    from studio.runtime.database.migrations import apply, check

    if options.command == "migration-import":
        import uvicorn

        from studio.apps.media_rendering.migration_artifacts import create_import_app
        from studio.contracts.management.migration_batches import MigrationPlan

        if options.migration_plan is None:
            raise ValueError("历史渲染导入需要迁移计划")
        try:
            plan = MigrationPlan.read(options.migration_plan)
        except (OSError, ValueError):
            raise ValueError("迁移计划无法读取或格式无效") from None
        app = create_import_app(plan=plan, state_root=options.state_root)
        uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)
        return
    if options.migration_plan is not None:
        raise ValueError("迁移计划仅用于历史渲染导入")
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

        from studio.apps.identity.clients.authorization import LiveAuthorization
        from studio.assembly.independent.media_rendering.application import create_app
        from studio.contracts.gateway.routing import RouteCatalog
        from studio.contracts.motion_compositor.motion_exports import load_export_key
        from studio.runtime.http.capability_client import CapabilityClient
        from studio.runtime.messaging.timed_peer import load_peer_key

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
        export_key = load_export_key(options.export_key, identity_credential=credential)
        media_key = load_peer_key(options.video_media_key, excluded=(credential, export_key))
        originals_key = load_peer_key(
            options.video_originals_key, excluded=(credential, export_key, media_key)
        )
        app = create_app(
            settings=settings,
            catalog=catalog,
            public_key=public,
            identity=LiveAuthorization(service="rendering", credential=credential),
            capabilities=CapabilityClient(
                service="rendering", credential=credential, catalog=catalog
            ),
            export_key=export_key,
            video_media_key=media_key,
            video_originals_key=originals_key,
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
