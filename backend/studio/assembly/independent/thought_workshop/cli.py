"""Installed Thought service with an explicit owned schema migration."""

import argparse
import json
import os
import sys
from pathlib import Path

from studio.config import read_config
from studio.runtime.database.migrations import apply, check
from studio.runtime.database.project_history_migration import (
    add_maintenance_options,
    handle_maintenance,
)
from studio.runtime.lifecycle.locking import service_lock

LIMIT_DEFAULTS = {
    "fpl_project_snapshot_max_bytes": 8 * 1024 * 1024 * 1024,
    "fpl_project_snapshot_max_files": 10000,
    "fpl_visual_asset_max_bytes": 200 * 1024 * 1024,
}


def parser():
    result = argparse.ArgumentParser(description="FPL Thought")
    result.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    add_maintenance_options(result)
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument("--connection", type=Path, default=Path("/run/fpl/identity-client.json"))
    result.add_argument("--thought-peer", type=Path, default=Path("/run/fpl/thought-peer.json"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    result.add_argument("--web-root", type=Path, default=Path("/app/web"))
    result.add_argument("--port", type=int, default=8080)
    return result


def configuration(path, state):
    if not path.is_file():
        raise ValueError("缺少只读 Thought 配置")
    data = read_config(path)
    if set(data) - {*LIMIT_DEFAULTS, "fpl_database_path"}:
        raise ValueError("Thought 配置包含外部服务字段")
    location = data.get("fpl_database_path")
    if not isinstance(location, str) or Path(location).resolve() != state / "service.db":
        raise ValueError("Thought 配置与状态目录不匹配")
    limits = {name: data.get(name, default) for name, default in LIMIT_DEFAULTS.items()}
    if any(type(value) is not int or value < 1 for value in limits.values()):
        raise ValueError("Thought 文件限制无效")
    return limits


def run(options):
    from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS

    state = options.state_root.resolve()
    limits = configuration(options.config, state)
    if options.command == "migrate":
        with service_lock(state):
            apply(state / "service.db", "thought", MIGRATIONS)
        print("Thought schema is current")
        return
    check(state / "service.db", "thought", MIGRATIONS)
    # Multipart files can exceed the container's small /tmp.
    uploads = state / ".tmp" / "http-uploads"
    if uploads.is_symlink() or not uploads.resolve().is_relative_to(state):
        raise ValueError("Thought 上传暂存目录越界")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads)

    import uvicorn
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    from studio.apps.asset_library.clients.retention import RetentionClient
    from studio.apps.identity.clients.authorization import LiveAuthorization
    from studio.apps.thought_workshop.archives.backup import BackupLimits
    from studio.assembly.independent.thought_workshop.application import create_app
    from studio.contracts.gateway.routing import RouteCatalog
    from studio.contracts.thought_workshop.thought_peer import ThoughtPeer

    public = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(public, Ed25519PublicKey):
        raise ValueError("Identity 公钥类型无效")
    connection = json.loads(options.connection.read_text())
    if (
        not isinstance(connection, dict)
        or set(connection) != {"credential"}
        or not isinstance(connection["credential"], str)
        or len(connection["credential"]) < 32
    ):
        raise ValueError("Thought 身份服务连接配置无效")
    credential = connection["credential"]
    peer = ThoughtPeer.read(options.thought_peer, identity_credential=credential)
    has_web = (options.web_root / "build.json").is_file()
    if not has_web and not (options.web_root / ".api-only").is_file():
        raise ValueError("Thought 缺少已安装的浏览器程序")
    app = create_app(
        state_root=state,
        catalog=RouteCatalog.read(options.catalog),
        public_key=public,
        credential=credential,
        identity=LiveAuthorization(service="thought", credential=credential),
        retention_client=RetentionClient(service="thought", credential=credential),
        assets_peer_credential=peer.community,
        upload_receipt_credential=peer.upload_receipt,
        upload_maximum_bytes=limits["fpl_visual_asset_max_bytes"],
        backup_limits=BackupLimits(
            maximum_files=limits["fpl_project_snapshot_max_files"],
            maximum_bytes=limits["fpl_project_snapshot_max_bytes"],
        ),
        schema_path=options.schema,
        web_root=options.web_root if has_web else None,
        version=os.environ.get("FPL_SERVICE_VERSION", "development"),
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        arguments = parser()
        options = arguments.parse_args()
        if options.command.startswith("migration-"):
            from .maintenance import create_export_app, create_import_app

            handle_maintenance(arguments, options, create_export_app, create_import_app)
        elif options.migration_plan is not None or options.legacy_db is not None:
            arguments.error("迁移计划与源快照仅用于维护入口")
        else:
            run(options)
    except (ValueError, RuntimeError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
