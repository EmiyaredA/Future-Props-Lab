"""Compose each website worker after checking persistent schema compatibility."""

import contextlib
import logging
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


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


def create_app():
    from app.runtime.config import get_settings
    from db.migrations import check_migrations

    settings = get_settings()
    # Every reload checks before app.main can import the database or run lifespan.
    # The reloader parent keeps the exclusive data locks throughout these reloads.
    check_migrations(settings.database_path)
    from app.capabilities.web_access.profiles import AccessError
    from app.capabilities.web_access.runtime import WebAccess
    from app.console.governance.automation_access import automation_allowed
    from app.main import app
    from app.runtime.website import attach_website

    web_root = Path(settings.fpl_website_web_root).expanduser()
    if not web_root.is_absolute():
        web_root = ROOT / web_root
    access = WebAccess(app, settings, ROOT, web_root, authenticate_browser)
    app.state.web_access = access
    attach_website(
        app,
        web_root=web_root,
        local_port=settings.fpl_website_port,
        frontend_origin=("http://127.0.0.1:3000" if settings.fpl_website_port == 9001 else None),
        public_access=access,
        automation_policy=automation_allowed,
    )
    original_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(application):
        async with original_lifespan(application) as state:
            try:
                if settings.fpl_website_public_enabled:
                    try:
                        await access.action("public_start")
                    except AccessError as exc:
                        logging.getLogger("uvicorn.error").error("公网入口启动失败：%s", exc)
                    except Exception:
                        logging.getLogger("uvicorn.error").error(
                            "公网入口启动失败，请检查网关版本和专用 SSH 连接；本机入口继续运行"
                        )
                yield state
            finally:
                await access.close()

    app.router.lifespan_context = lifespan
    return app
