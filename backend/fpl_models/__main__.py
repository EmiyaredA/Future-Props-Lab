"""Installed Models serving; migration is explicit and never inferred at startup."""

import argparse
import json
import os
import sys
from pathlib import Path

from fpl_runtime.locking import service_lock


def parser():
    result = argparse.ArgumentParser(description="FPL Models")
    result.add_argument("command", choices=("serve", "migrate"))
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
    return result


def run(options):
    if not options.config.is_file():
        raise ValueError("缺少只读 Models 配置")
    os.environ["FPL_CONFIG_FILE"] = str(options.config.resolve())
    from app.runtime.config import get_settings
    from fpl_runtime.migrations import apply, check

    from .migrations.registry import MIGRATIONS

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

        from fpl_runtime.capability_client import CapabilityClient
        from fpl_runtime.identity_client import LiveAuthorization
        from fpl_runtime.integration_client import IntegrationIntentClient
        from fpl_runtime.routing import RouteCatalog

        from .account_directory import TemplateDirectory
        from .account_events import CatalogEventClient
        from .application import create_app
        from .audit_client import ModelAuditClient
        from .demo_installations import DemoInstallClient

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
