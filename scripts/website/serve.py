"""Run one locked website process. Configuration precedes all database imports."""

import argparse
import asyncio
import contextlib
import fcntl
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))


async def authenticate_browser(scope, receive):
    from starlette.requests import Request

    from app.deps import authenticate_studio_request
    from app.runtime.db import SessionLocal

    async with SessionLocal() as session:
        await authenticate_studio_request(
            Request(scope, receive),
            session,
            required_scope="studio:read",
            allow_forced_password_change=True,
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--config", type=Path, default=ROOT / "backend/config.toml")
    args = parser.parse_args()
    # A production service never inherits a development database or secret override.
    for name in list(os.environ):
        if name.startswith("FPL_") or name == "CORS_ORIGINS":
            os.environ.pop(name)
    os.environ["FPL_CONFIG_FILE"] = str(args.config.resolve())
    from app.runtime.config import get_settings

    settings = get_settings()
    web_root = Path(settings.fpl_website_web_root).expanduser()
    if not web_root.is_absolute():
        web_root = ROOT / web_root
    if not (web_root / "index.html").is_file():
        raise SystemExit("网站构建缺失，请运行 npm run build:studio")
    if not settings.database_path.is_file():
        raise SystemExit("网站数据库不存在；请先完成正式迁移或显式初始化隔离环境")
    settings.runtime_path.mkdir(mode=0o700, parents=True, exist_ok=True)
    with contextlib.ExitStack() as stack:
        lock = stack.enter_context((settings.runtime_path / "website.lock").open("a"))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("已有网站实例使用此数据目录") from None
        os.chmod(lock.name, 0o600)
        if settings.fpl_website_legacy_data_root:
            original = Path(settings.fpl_website_legacy_data_root).expanduser()
            if original.is_dir():
                legacy_lock = stack.enter_context((original / "backend.lock").open("a"))
                try:
                    fcntl.flock(legacy_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise SystemExit("旧桌面实例仍在运行，请先正常退出") from None
        from db.migrations import check_migrations

        # Compatibility is checked only after both data locks are held.
        check_migrations(settings.database_path)
        if args.check:
            print("Website configuration, build and database migrations are ready")
            return
        asyncio.run(serve(settings, web_root))


async def serve(settings, web_root):
    import uvicorn

    from app.capabilities.web_access.profiles import AccessError
    from app.capabilities.web_access.runtime import WebAccess
    from app.console.governance.automation_access import automation_allowed
    from app.main import app
    from app.runtime.website import attach_website

    access = WebAccess(app, settings, ROOT, web_root, authenticate_browser)
    app.state.web_access = access
    attach_website(
        app,
        web_root=web_root,
        local_port=settings.fpl_website_port,
        public_access=access,
        automation_policy=automation_allowed,
    )

    class Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets)
            if self.started and settings.fpl_website_public_enabled:
                try:
                    await access.action("public_start")
                except AccessError as exc:
                    logging.getLogger("uvicorn.error").error("公网入口启动失败：%s", exc)
                except Exception:
                    logging.getLogger("uvicorn.error").error(
                        "公网入口启动失败，请检查网关版本和专用 SSH 连接；本机入口继续运行"
                    )

    server = Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=settings.fpl_website_port,
            workers=1,
            proxy_headers=False,
            access_log=False,
            timeout_graceful_shutdown=10,
        )
    )
    try:
        await server.serve()
    finally:
        await access.close()


if __name__ == "__main__":
    main()
