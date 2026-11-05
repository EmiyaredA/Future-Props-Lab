"""Compose each website worker after checking persistent schema compatibility."""

import asyncio
import contextlib
import logging
import socket
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@contextlib.asynccontextmanager
async def local_frontend(app, enabled):
    if not enabled:
        yield
        return
    import uvicorn

    from app.capabilities.web_access.runtime import BrowserServer

    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 3000))
        server = BrowserServer(
            uvicorn.Config(
                app,
                lifespan="off",
                access_log=False,
                proxy_headers=False,
                timeout_graceful_shutdown=5,
            )
        )
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("本机前端监听启动失败")
                await asyncio.sleep(0.05)
            yield
        finally:
            server.should_exit = True
            await task


async def authenticate_browser(scope, receive, *, sessions):
    from starlette.requests import Request

    from studio.assembly.http_dependencies import authenticate_studio_request

    async with sessions() as session:
        await authenticate_studio_request(
            Request(scope, receive),
            session,
            required_scope="studio:read",
            allow_forced_password_change=True,
        )


def create_app():
    from db.migrations import check_migrations
    from studio.config.settings import get_settings

    settings = get_settings()
    # Every reload checks before constructing storage or running the website lifespan.
    # The reloader parent keeps the exclusive data locks throughout these reloads.
    check_migrations(settings.database_path)
    from scripts.website.frontend import CURRENT

    from app.capabilities.web_access.profiles import AccessError
    from app.capabilities.web_access.runtime import WebAccess
    from studio.assembly.website.application import create_app as create_backend_app
    from studio.contracts.gateway.automation_policy import automation_allowed

    app = create_backend_app(settings)
    from studio.runtime.http.website import CurrentWebsite, attach_website

    web_root = Path(settings.fpl_website_web_root).expanduser()
    if not web_root.is_absolute():
        web_root = ROOT / web_root
    shared = web_root == ROOT / CURRENT and settings.fpl_website_port == 9001
    static = CurrentWebsite(web_root) if shared else None
    access = WebAccess(
        app,
        settings,
        ROOT,
        web_root,
        partial(authenticate_browser, sessions=app.state.database.sessions),
        shared_static=static,
    )
    app.state.web_access = access
    attach_website(
        app,
        web_root=web_root,
        local_port=settings.fpl_website_port,
        frontend_origin=("http://127.0.0.1:3000" if settings.fpl_website_port == 9001 else None),
        frontend_port=3000 if shared else None,
        static=static,
        public_access=access,
        automation_policy=automation_allowed,
    )
    original_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(application):
        async with original_lifespan(application) as state, local_frontend(application, shared):
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
