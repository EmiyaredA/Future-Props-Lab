"""Explicit owned migrations and installed Assets serving, without dotenv or secrets key."""

import argparse
import os
import sys
from pathlib import Path

from fpl_runtime.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Assets")
    result.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    result.add_argument("--connection", type=Path, default=Path("/run/fpl/identity-client.json"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument("--web-root", type=Path, default=Path("/app/web"))
    result.add_argument("--thought-peer", type=Path)
    result.add_argument(
        "--presentation-archive-key", type=Path, default=Path("/run/fpl/presentation-archive-key")
    )
    result.add_argument(
        "--motion-archive-key", type=Path, default=Path("/run/fpl/motion-archive-key")
    )
    result.add_argument("--port", type=int, default=8080)
    result.add_argument("--migration-plan", type=Path)
    result.add_argument("--legacy-db", type=Path)
    return result


def maintenance(options):
    import uvicorn

    from fpl_runtime.migration_batches import MigrationPlan

    from .migration_application import create_export_app, create_import_app

    if options.migration_plan is None or (
        (options.command == "migration-export") != (options.legacy_db is not None)
    ):
        raise ValueError("维护入口需要迁移计划，仅导出入口接受源快照")
    try:
        plan = MigrationPlan.read(options.migration_plan)
    except (OSError, ValueError):
        raise ValueError("迁移计划无法读取或格式无效") from None
    if options.legacy_db is None:
        app = create_import_app(plan=plan, state_root=options.state_root)
    else:
        app = create_export_app(plan=plan, source_path=options.legacy_db)
    uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)


def run(options):
    from fpl_runtime.migrations import apply, check

    from .migrations.registry import MIGRATIONS
    from .settings import load_settings

    if options.command.startswith("migration-"):
        maintenance(options)
        return
    if options.migration_plan is not None or options.legacy_db is not None:
        raise ValueError("迁移计划与源快照仅用于维护入口")
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

        # Multipart spooling may exceed the small read-only container tmpfs.
        uploads = state / ".tmp" / "http-uploads"
        if uploads.is_symlink():
            raise ValueError("Assets 上传暂存目录不能是符号链接")
        uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not uploads.resolve().is_relative_to(state):
            raise ValueError("Assets 上传暂存目录越界")
        os.environ["TMPDIR"] = str(uploads)

        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from fpl_runtime.capability_client import CapabilityClient
        from fpl_runtime.identity_client import LiveAuthorization
        from fpl_runtime.routing import RouteCatalog
        from fpl_runtime.thought_peer import ThoughtPeer

        from .application import create_app
        from .community_assets import CommunityAssetChecks

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
        thought_peer = (
            ThoughtPeer.read(options.thought_peer, identity_credential=credential)
            if options.thought_peer is not None
            else None
        )
        archive_key = (
            options.presentation_archive_key.read_text().strip()
            if options.presentation_archive_key.is_file()
            else None
        )
        if archive_key is not None and archive_key in {
            credential,
            *(
                set()
                if thought_peer is None
                else {thought_peer.community, thought_peer.upload_receipt}
            ),
        }:
            raise ValueError("演示导入对等凭据必须独立")
        motion_key = (
            options.motion_archive_key.read_text().strip()
            if options.motion_archive_key.is_file()
            else None
        )
        if motion_key is not None and motion_key in {
            archive_key,
            credential,
            *(
                set()
                if thought_peer is None
                else {thought_peer.community, thought_peer.upload_receipt}
            ),
        }:
            raise ValueError("特效归档对等凭据必须独立")
        has_web = (options.web_root / "build.json").is_file()
        if not has_web and not (options.web_root / ".api-only").is_file():
            raise ValueError("Assets 缺少已安装的浏览器程序")
        app = create_app(
            settings=settings,
            catalog=catalog,
            public_key=public,
            identity=identity,
            capabilities=capabilities,
            community_asset_checks=CommunityAssetChecks(
                identity_credential=credential, thought_credential=thought_peer.community
            )
            if thought_peer
            else None,
            thought_upload_result_key=thought_peer.upload_receipt if thought_peer else None,
            presentation_archive_key=archive_key,
            motion_archive_key=motion_key,
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
