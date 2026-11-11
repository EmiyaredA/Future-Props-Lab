"""Installed Models serving; migration is explicit and never inferred at startup."""

import argparse
import json
import os
import sys
from pathlib import Path

from studio.runtime.lifecycle.locking import service_lock
from studio.runtime.messaging.timed_peer import load_peer_key


def parser():
    result = argparse.ArgumentParser(description="FPL Models")
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
    result.add_argument("--native-ingress", type=Path, default=Path("/run/fpl/native-ingress"))
    result.add_argument("--workers", type=Path, default=Path("/run/fpl/workers.json"))
    result.add_argument("--port", type=int, default=8080)
    result.add_argument("--migration-plan", type=Path)
    result.add_argument("--legacy-db", type=Path)
    return result


def maintenance(options):
    import stat

    import uvicorn

    from studio.assembly.independent.model_service.maintenance import (
        create_export_app,
        create_import_app,
    )
    from studio.config import read_config
    from studio.contracts.management.migration_batches import MigrationPlan

    if options.migration_plan is None or (
        (options.command == "migration-export") != (options.legacy_db is not None)
    ):
        raise ValueError("维护入口需要迁移计划，仅导出入口接受源快照")
    try:
        plan = MigrationPlan.read(options.migration_plan)
    except (OSError, ValueError):
        raise ValueError("迁移计划无法读取或格式无效") from None
    if options.legacy_db is not None:
        app = create_export_app(plan=plan, source_path=options.legacy_db)
    else:
        try:
            info = options.config.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError
            settings = read_config(options.config)
            expected = options.state_root.resolve() / "service.db"
            if Path(settings["fpl_database_path"]).resolve() != expected:
                raise ValueError
            app = create_import_app(
                plan=plan, state_root=options.state_root, secret_key=settings["fpl_secrets_key"]
            )
        except (OSError, ValueError, KeyError, TypeError):
            raise ValueError("Models 迁移需要目标自有数据库及原加密密钥的私有配置") from None
    uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)


def run(options):
    if options.command.startswith("migration-"):
        maintenance(options)
        return
    if options.migration_plan is not None or options.legacy_db is not None:
        raise ValueError("迁移计划与源快照仅用于维护入口")
    if not options.config.is_file():
        raise ValueError("缺少只读 Models 配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
    from studio.config.settings import get_settings
    from studio.runtime.database.migrations import apply, check

    settings = get_settings()
    state = options.state_root.resolve()
    if settings.database_path != state / "service.db":
        raise ValueError("Models 配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "models", MIGRATIONS)
            print("Models schema is current")
            return
        check(state / "service.db", "models", MIGRATIONS)
        uploads = state / ".tmp" / "http-uploads"
        if uploads.is_symlink():
            raise ValueError("Models 上传暂存目录不能是符号链接")
        uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not uploads.resolve().is_relative_to(state):
            raise ValueError("Models 上传暂存目录越界")
        os.environ["TMPDIR"] = str(uploads)
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from studio.apps.identity.clients.authorization import LiveAuthorization
        from studio.apps.integrations.clients.authority import IntegrationIntentClient
        from studio.apps.model_service.account_directory import TemplateDirectory
        from studio.apps.model_service.account_events import CatalogEventClient
        from studio.apps.model_service.audit.audit_client import ModelAuditClient
        from studio.apps.model_service.demo_installations import DemoInstallClient
        from studio.assembly.independent.model_service.application import create_app
        from studio.contracts.gateway.routing import RouteCatalog
        from studio.runtime.http.capability_client import CapabilityClient

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        connection = json.loads(options.connection.read_text())
        if (
            set(connection) != {"credential"}
            or not isinstance(connection["credential"], str)
            or len(connection["credential"]) < 32
        ):
            raise ValueError("Models 身份服务连接配置无效")
        catalog = RouteCatalog.read(options.catalog)
        credential = connection["credential"]
        has_web = (options.web_root / "build.json").is_file()
        if not has_web and not (options.web_root / ".api-only").is_file():
            raise ValueError("Models 缺少已安装的浏览器程序")
        integration_intents = IntegrationIntentClient(service="models", credential=credential)
        app = create_app(
            settings=settings,
            visual_generation_key=load_peer_key(
                Path("/run/fpl/visual-generation-key"), excluded=(credential,)
            ),
            catalog=catalog,
            public_key=public,
            identity=LiveAuthorization(service="models", credential=credential),
            capabilities=CapabilityClient(service="models", credential=credential, catalog=catalog),
            events=CatalogEventClient(credential=credential),
            directory=TemplateDirectory(credential=credential),
            audit=ModelAuditClient(credential=credential),
            integration_intents=integration_intents,
            demo_install_client=DemoInstallClient(integration_intents),
            native_ingress_token=options.native_ingress.read_text().strip()
            if options.native_ingress.exists()
            else None,
            workers=json.loads(options.workers.read_text()) if options.workers.exists() else None,
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
