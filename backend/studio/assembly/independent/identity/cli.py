"""Explicit maintenance and account-only serving. Starting never runs migrations."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from studio.runtime.lifecycle.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Identity service")
    result.add_argument(
        "command",
        choices=("serve", "migrate", "create-admin", "migration-export", "migration-import"),
    )
    result.add_argument("--migration-plan", type=Path)
    result.add_argument("--legacy-db", type=Path)
    result.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    result.add_argument("--state-root", type=Path, default=Path("/state"))
    result.add_argument("--signing-key", type=Path, default=Path("/run/fpl/identity-signing.pem"))
    result.add_argument("--gateway-token", type=Path, default=Path("/run/fpl/gateway-token"))
    result.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    result.add_argument(
        "--service-credentials", type=Path, default=Path("/run/fpl/service-credentials.json")
    )
    result.add_argument(
        "--management-gateway-token", type=Path, default=Path("/run/fpl/management-gateway-token")
    )
    result.add_argument("--port", type=int, default=8080)
    return result


def run_maintenance(options):
    import uvicorn

    from studio.assembly.independent.identity.maintenance import (
        create_export_app,
        create_import_app,
    )
    from studio.contracts.management.migration_batches import MigrationPlan

    if options.migration_plan is None:
        raise ValueError("迁移维护入口需要 --migration-plan")
    if (options.command == "migration-export") != (options.legacy_db is not None):
        raise ValueError("仅导出入口需要并接受 --legacy-db")
    try:
        plan = MigrationPlan.read(options.migration_plan)
    except (OSError, ValueError):
        raise ValueError("迁移计划无法读取或格式无效") from None
    if options.legacy_db is not None:
        app = create_export_app(plan=plan, source_path=options.legacy_db)
    else:
        app = create_import_app(plan=plan, state_root=options.state_root)
    uvicorn.run(app, host="127.0.0.1", port=options.port, proxy_headers=False, access_log=False)


def run(options):
    if options.command.startswith("migration-"):
        run_maintenance(options)
        return
    if options.migration_plan is not None or options.legacy_db is not None:
        raise ValueError("迁移计划与源快照仅适用于迁移维护入口")
    if not options.config.is_file():
        raise ValueError("缺少只读服务配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from studio.config.settings import get_settings

    settings = get_settings()
    state = options.state_root.resolve()
    if settings.database_path != state / "service.db":
        raise ValueError("Identity 配置与挂载目录不匹配")
    from studio.apps.identity.storage.migrations.registry import MIGRATIONS
    from studio.runtime.database.migrations import apply, check

    with service_lock(state):
        if options.command == "migrate":
            apply(state / "service.db", "identity", MIGRATIONS)
            print("Identity schema is current")
            return
        check(state / "service.db", "identity", MIGRATIONS)
        if options.command == "create-admin":
            asyncio.run(bootstrap(state))
            return
        import uvicorn
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import load_pem_private_key

        from studio.assembly.independent.identity.application import create_app
        from studio.contracts.gateway.routing import RouteCatalog

        key = load_pem_private_key(options.signing_key.read_bytes(), password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("Identity 签名密钥类型无效")
        app = create_app(
            state_root=state,
            catalog=RouteCatalog.read(options.catalog),
            gateway_token=options.gateway_token.read_text().strip(),
            local_origin=f"http://127.0.0.1:{settings.fpl_website_port}",
            public_origin=settings.fpl_remote_web_origin,
            private_key=key,
            management_gateway_token=options.management_gateway_token.read_text().strip()
            if options.management_gateway_token.exists()
            else None,
            management_local_origin=settings.fpl_management_local_origin,
            management_public_origin=settings.fpl_management_public_origin,
            service_credentials=json.loads(options.service_credentials.read_text())
            if options.service_credentials.exists()
            else {},
            version=os.environ.get("FPL_SERVICE_VERSION", "development"),
        )
        uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


async def bootstrap(state):
    from sqlalchemy import func, select

    from app.capabilities.identity.passwords import validate_password
    from app.console.models.accounts import User
    from studio.apps.identity.accounts import create_account
    from studio.assembly.independent.identity.application import MODELS
    from studio.runtime.database.sessions import Database

    values = json.load(sys.stdin)
    password = values.get("password", "")
    validate_password(password)
    database = Database("identity", state, models=MODELS, account_models=())
    try:
        async with database.sessions() as session:
            if await session.scalar(select(func.count(User.id))):
                raise ValueError("已有账号，首次管理员入口已关闭")
            await create_account(
                session,
                username=values["username"],
                display_name=values.get("display_name", values["username"]),
                password=password,
                platform_role="admin",
            )
        print("Initial administrator created")
    finally:
        await database.close()


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
