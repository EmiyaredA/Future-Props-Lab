"""Compose each website worker after checking persistent schema compatibility."""

import asyncio
import contextlib
import logging
import socket
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


@contextlib.asynccontextmanager
async def loopback_listener(app, port, **transport_options):
    if port is None:
        yield
        return
    import uvicorn

    from studio.assembly.website.public_access import BrowserServer

    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
        server = BrowserServer(
            uvicorn.Config(
                app,
                lifespan="off",
                access_log=False,
                proxy_headers=False,
                timeout_graceful_shutdown=5,
                **transport_options,
            )
        )
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError(f"本机监听启动失败（端口 {port}）")
                await asyncio.sleep(0.05)
            yield
        finally:
            server.should_exit = True
            await task


def local_happier_tls(settings):
    if not settings.fpl_happier_studio_origin:
        return {}
    return {
        "ssl_certfile": settings.fpl_happier_tls_certfile,
        "ssl_keyfile": settings.fpl_happier_tls_keyfile,
    }


@contextlib.asynccontextmanager
async def happier_listener(app, settings):
    if app.state.happier is None or app.state.storage_upgrade_required:
        yield
        return
    from studio.apps.gateway.transport.happier_ingress import MAX_UPDATES_FRAME_BYTES

    ingress = app.state.happier.ingress()
    async with (
        ingress.client,
        loopback_listener(
            ingress,
            settings.fpl_happier_listen_port,
            ws_max_size=MAX_UPDATES_FRAME_BYTES,
            **local_happier_tls(settings),
        ),
    ):
        yield


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
    from studio.config.settings import get_cloud_settings, get_settings

    settings = get_settings()
    # Every reload checks before constructing storage or running the website lifespan.
    # The reloader parent keeps the exclusive data locks throughout these reloads.
    check_migrations(settings.database_path)
    from scripts.website.frontend import CURRENT

    from studio.assembly.website.application import create_app as create_backend_app
    from studio.assembly.website.public_access import WebAccess
    from studio.contracts.gateway.automation_policy import automation_allowed
    from studio.contracts.gateway.web_access import AccessError

    app = create_backend_app(settings, read_cloud_settings=get_cloud_settings)
    from studio.runtime.http.remote_web import RemoteWeb
    from studio.runtime.http.website import CurrentWebsite, WebsiteStaticFiles, attach_website

    web_root = Path(settings.fpl_website_web_root).expanduser()
    if not web_root.is_absolute():
        web_root = ROOT / web_root
    shared = web_root == ROOT / CURRENT and settings.fpl_website_port == 9001
    static = CurrentWebsite(web_root) if shared else None
    authenticate = partial(authenticate_browser, sessions=app.state.database.sessions)
    access = WebAccess(
        app,
        settings,
        ROOT,
        web_root,
        authenticate,
        shared_static=static,
        local_https_enabled=app.state.happier is not None
        and not settings.fpl_happier_studio_origin,
    )
    app.state.web_access = access
    happier_local = None
    if settings.fpl_happier_studio_origin:
        happier_local = RemoteWeb(
            origin=settings.fpl_happier_studio_origin,
            port=urlsplit(settings.fpl_happier_studio_origin).port,
            static=static or WebsiteStaticFiles(directory=web_root, html=True),
            authenticate=authenticate,
        )
    attach_website(
        app,
        web_root=web_root,
        local_port=settings.fpl_website_port,
        frontend_origin=("http://127.0.0.1:3000" if settings.fpl_website_port == 9001 else None),
        frontend_port=3000 if shared else None,
        static=static,
        public_access=access,
        happier_local=happier_local,
        automation_policy=automation_allowed,
    )
    original_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(application):
        async with (
            original_lifespan(application) as state,
            loopback_listener(application, 3000 if shared else None),
            happier_listener(application, settings),
            loopback_listener(
                application,
                happier_local.port
                if happier_local and not application.state.storage_upgrade_required
                else None,
                **local_happier_tls(settings),
            ),
        ):
            try:
                if access.local_https_enabled and not app.state.storage_upgrade_required:
                    await access.action("local_start")
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
