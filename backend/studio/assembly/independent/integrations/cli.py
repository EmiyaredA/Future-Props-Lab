"""Installed Integrations serving; migration is explicit and never inferred at startup."""

import argparse
import json
import os
import stat
import sys
from pathlib import Path

from studio.runtime.database.project_history_migration import (
    add_maintenance_options,
    handle_maintenance,
)
from studio.runtime.lifecycle.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Integrations")
    result.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    add_maintenance_options(result)
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
    result.add_argument("--creative-install-credentials", type=Path)
    result.add_argument("--port", type=int, default=8080)
    return result


def import_from_config(config, *, plan, state_root):
    from studio.config import read_config

    from .maintenance import create_import_app

    info = config.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Integrations 迁移配置必须是本用户独占的普通文件")
    settings = read_config(config)
    database = settings.get("fpl_database_path")
    key = settings.get("fpl_secrets_key")
    if (
        not isinstance(database, str)
        or Path(database).resolve() != state_root.resolve() / "service.db"
        or not isinstance(key, str)
    ):
        raise ValueError("Integrations 迁移需要目标数据库及原加密密钥")
    return create_import_app(plan=plan, state_root=state_root, secret_key=key)


def run(options):
    if not options.config.is_file():
        raise ValueError("缺少只读 Integrations 配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
    from studio.config.settings import get_settings
    from studio.runtime.database.migrations import apply, check

    settings = get_settings()
    state = options.state_root.resolve()
    if settings.database_path != state / "service.db":
        raise ValueError("Integrations 配置与挂载目录不匹配")
    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "integrations", MIGRATIONS)
            print("Integrations schema is current")
            return
        check(state / "service.db", "integrations", MIGRATIONS)
        uploads = state / ".tmp" / "http-uploads"
        if uploads.is_symlink():
            raise ValueError("Integrations 上传暂存目录不能是符号链接")
        uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not uploads.resolve().is_relative_to(state):
            raise ValueError("Integrations 上传暂存目录越界")
        os.environ["TMPDIR"] = str(uploads)
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        from studio.apps.identity.clients.authorization import LiveAuthorization
        from studio.apps.integrations.clients.authority import IntegrationIntentClient
        from studio.apps.integrations.validation import ValidationCapacityClient
        from studio.assembly.independent.integrations.application import create_app
        from studio.contracts.gateway.routing import RouteCatalog

        public = load_pem_public_key(options.public_key.read_bytes())
        if not isinstance(public, Ed25519PublicKey):
            raise ValueError("Identity 公钥类型无效")
        connection = json.loads(options.connection.read_text())
        if (
            set(connection) != {"credential"}
            or not isinstance(connection["credential"], str)
            or len(connection["credential"]) < 32
        ):
            raise ValueError("Integrations 身份服务连接配置无效")
        catalog = RouteCatalog.read(options.catalog)
        credential = connection["credential"]
        creative_authorization = None
        if options.creative_install_credentials is not None:
            from studio.apps.integrations.creative_authority import CreativeHttpAuthority
            from studio.config.creative_credentials import CreativeInstallCredentials

            peer, target, result = CreativeInstallCredentials.read(
                options.creative_install_credentials
            )
            if credential in {peer, target, result}:
                raise ValueError("Creative 安装凭据必须与 Integrations 身份凭据独立")
            creative_authorization = CreativeHttpAuthority(
                creative_peer_credential=peer,
                integrations_credential=target,
                result_credential=result,
            )
        has_web = (options.web_root / "build.json").is_file()
        if not has_web and not (options.web_root / ".api-only").is_file():
            raise ValueError("Integrations 缺少已安装的浏览器程序")
        intents = IntegrationIntentClient(service="integrations", credential=credential)
        app = create_app(
            settings=settings,
            catalog=catalog,
            public_key=public,
            identity=LiveAuthorization(service="integrations", credential=credential),
            intents=intents,
            capacity=ValidationCapacityClient(intents),
            creative_authorization=creative_authorization,
            native_ingress=options.native_ingress.read_text().strip(),
            native_workers=json.loads(options.workers.read_text()),
            web_root=options.web_root if has_web else None,
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    try:
        arguments = parser()
        options = arguments.parse_args()
        if options.command.startswith("migration-"):
            from functools import partial

            from .maintenance import create_export_app

            handle_maintenance(
                arguments, options, create_export_app, partial(import_from_config, options.config)
            )
        elif options.migration_plan is not None or options.legacy_db is not None:
            arguments.error("迁移计划与源快照仅用于维护入口")
        else:
            run(options)
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
