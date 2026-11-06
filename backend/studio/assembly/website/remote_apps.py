"""Website assembly for Mac app discovery, authorization and WebRTC signaling."""

import asyncio
import re
from contextlib import suppress

import tomlkit
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket
from starlette.websockets import WebSocketDisconnect

from studio.apps.identity.storage.cloud_access import (
    desktop_authorized,
    recently_reauthenticated,
    require_enabled,
)
from studio.apps.management.config_updates import config_bytes, replace_config, revision
from studio.apps.remote_desktop.transport.app_signaling import bridge, read_message
from studio.apps.remote_desktop.use_cases.app_sessions import AppSessions, turn_servers
from studio.assembly.http_dependencies import (
    SessionDep,
    StudioAuth,
    resolve_studio_websocket_principal,
)
from studio.config import CONFIG_FILE
from studio.config.settings import get_cloud_settings
from studio.contracts.remote_desktop.apps import (
    InstalledRemoteApps,
    RemoteAppCatalog,
    RemoteAppConnect,
    RemoteAppHandshake,
    SaveRemoteApps,
)
from studio.host.remote_apps.bridge import HostUnavailable, installed_apps, run_host
from studio.runtime.http.website import require_local_browser

router = APIRouter(prefix="/apps")
PROTOCOL = "fpl-remote-app-v1"


def local_request(request):
    return getattr(request.state, "website_local", False)


def allowed_ids(settings):
    return [
        item
        for item in settings.fpl_cloud_control_apps_allowed.split(":")
        if re.fullmatch("[a-f0-9]{64}", item)
    ]


class RemoteApps(AppSessions):
    def __init__(self, *, sessions, preferences):
        super().__init__()
        self._sessions = sessions
        self._preferences = preferences
        self.capture = asyncio.Lock()

    async def access(self, principal, local, app):
        settings = get_cloud_settings()
        if not settings.fpl_cloud_control_apps_enabled or app not in allowed_ids(settings):
            return None
        async with self._sessions() as db:
            if not await desktop_authorized(db, principal, local=local):
                return None
        return (await self._preferences.read(owner=principal.user_id)).idle_minutes


def settings_for(principal, local):
    settings = get_cloud_settings()
    require_enabled(principal, local=local, desktop=True, settings=settings)
    if not settings.fpl_cloud_control_apps_enabled:
        raise HTTPException(404, "远程应用尚未启用")
    return settings


async def catalog(settings):
    try:
        return await installed_apps(settings.fpl_cloud_control_apps_host)
    except HostUnavailable as error:
        raise HTTPException(503, str(error)) from None


def no_store(response):
    response.headers["Cache-Control"] = "no-store"


@router.get("", response_model=RemoteAppCatalog)
async def list_apps(request: Request, response: Response, db: SessionDep, principal: StudioAuth):
    local = local_request(request)
    settings = settings_for(principal, local)
    if not await desktop_authorized(db, principal, local=local):
        raise HTTPException(403, "请先验证云控访问权限")
    await db.rollback()
    no_store(response)
    ids = allowed_ids(settings)
    if not ids:
        return RemoteAppCatalog(apps=[])
    by_id = {app.id: app for app in await catalog(settings)}
    return RemoteAppCatalog(apps=[by_id[key] for key in ids if key in by_id])


@router.get("/installed", response_model=InstalledRemoteApps)
async def installed(request: Request, response: Response, principal: StudioAuth):
    require_local_browser(request, principal)
    raw = config_bytes(CONFIG_FILE)
    settings = settings_for(principal, True)
    apps = await catalog(settings)
    if config_bytes(CONFIG_FILE) != raw:
        raise HTTPException(409, "配置已变更，请刷新应用列表")
    no_store(response)
    return InstalledRemoteApps(apps=apps, revision=revision(raw), allowed_ids=allowed_ids(settings))


@router.put("", response_model=InstalledRemoteApps)
async def save_apps(
    request: Request,
    response: Response,
    body: SaveRemoteApps,
    db: SessionDep,
    principal: StudioAuth,
):
    require_local_browser(request, principal)
    settings = settings_for(principal, True)
    if not await recently_reauthenticated(db, principal):
        raise HTTPException(
            403, {"code": "reauthentication_required", "message": "请重新验证管理员密码"}
        )
    await db.rollback()
    apps = await catalog(settings)
    current = set(allowed_ids(settings)) | {app.id for app in apps}
    if len(set(body.app_ids)) != len(body.app_ids) or not set(body.app_ids) <= current:
        raise HTTPException(422, "应用列表包含无效或重复的应用")

    def edit(document):
        document.setdefault("cloud_control", tomlkit.table())["apps_allowed"] = body.app_ids

    await asyncio.to_thread(replace_config, CONFIG_FILE, body.revision, edit)
    return await installed(request, response, principal)


def ice_for(settings, local):
    return (
        []
        if local
        else turn_servers(
            settings.fpl_cloud_control_apps_turn_urls, settings.fpl_cloud_control_apps_turn_secret
        )
    )


@router.post("/connect", response_model=RemoteAppHandshake)
async def connect(
    request: Request,
    response: Response,
    body: RemoteAppConnect,
    db: SessionDep,
    principal: StudioAuth,
):
    local = local_request(request)
    settings = settings_for(principal, local)
    if not await desktop_authorized(db, principal, local=local):
        raise HTTPException(403, "请先验证云控访问权限")
    if body.app_id not in allowed_ids(settings):
        raise HTTPException(404, "应用不可用")
    await db.rollback()
    if not request.app.state.auth_attempts.allow(f"remote-app:{principal.user_id}", 24):
        raise HTTPException(429, "连接尝试过多，请稍后重试")
    if not any(app.id == body.app_id for app in await catalog(settings)):
        raise HTTPException(404, "应用已卸载或不可用")
    ticket = request.app.state.remote_apps.issue(principal, local, body.app_id)
    if ticket is None:
        raise HTTPException(503, "远程应用暂不可用")
    no_store(response)
    return RemoteAppHandshake(ticket=ticket, ice_servers=ice_for(settings, local))


@router.websocket("/socket")
async def app_socket(socket: WebSocket):
    local = local_request(socket)
    settings = get_cloud_settings()
    origins = (
        {"http://127.0.0.1:3000", f"http://127.0.0.1:{settings.fpl_website_port}"}
        if local
        else {settings.fpl_remote_web_origin}
    )
    origin = socket.headers.get("origin")
    if not origin or origin not in origins or PROTOCOL not in socket.scope["subprotocols"]:
        await socket.close(4403)
        return
    try:
        principal = await resolve_studio_websocket_principal(socket, "cloud-control.access")
        settings_for(principal, local)
    except HTTPException:
        await socket.close(4403)
        return
    service = socket.app.state.remote_apps
    await socket.accept(subprotocol=PROTOCOL)
    try:
        async with asyncio.timeout(5):
            hello = await read_message(socket)
        token = hello.get("ticket")
        ticket = service.take(token, principal, local) if isinstance(token, str) else None
        if ticket is None or await service.access(principal, local, ticket.app) is None:
            await socket.close(4403, "应用授权已失效")
            return
        try:
            await asyncio.wait_for(service.capture.acquire(), 3)
        except TimeoutError:
            await socket.close(4410, "Mac 正在处理另一条远程应用连接")
            return
        try:
            if await service.access(principal, local, ticket.app) is None:
                await socket.close(4403, "应用授权已失效")
                return
            settings = get_cloud_settings()
            async with run_host(
                settings.fpl_cloud_control_apps_host, "session", ticket.app
            ) as process:
                await bridge(
                    socket,
                    process,
                    access=lambda: service.access(principal, local, ticket.app),
                    ice_servers=[server.model_dump() for server in ice_for(settings, local)],
                )
        finally:
            service.capture.release()
    except WebSocketDisconnect:
        pass
    except (TimeoutError, ValueError, HostUnavailable, OSError):
        with suppress(RuntimeError, OSError):
            await socket.close(4411, "无法建立远程应用连接")
