"""Remote-owned app tickets, authorization and browser signaling."""

import asyncio
from contextlib import suppress

import jwt
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket
from starlette.websockets import WebSocketDisconnect

from studio.apps.remote_desktop.transport.app_signaling import read_message, relay_signaling
from studio.apps.remote_desktop.use_cases.app_sessions import turn_servers
from studio.assembly.identity_http import require_recent_reauthentication
from studio.config import ConfigurationError
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.remote_desktop.apps import (
    APP_PROTOCOL,
    APP_SOCKET,
    InstalledRemoteApps,
    RemoteAppCatalog,
    RemoteAppConnect,
    RemoteAppHandshake,
    SaveRemoteApps,
)
from studio.runtime.http.dependencies import StudioAuth
from studio.runtime.http.website import require_local_browser

router = APIRouter(prefix="/cloud-control/apps", tags=["cloud-control"])


def app_policy(state):
    try:
        values = state.cloud_projection.read() if state.cloud_projection is not None else {}
    except ConfigurationError:
        raise HTTPException(503, "remote_cloud_projection_unavailable") from None
    return (
        values.get("fpl_cloud_control_apps_enabled", False),
        set(filter(None, values.get("fpl_cloud_control_apps_allowed", "").split(":"))),
    )


def allowed_apps(state):
    enabled, allowed = app_policy(state)
    if not enabled:
        raise HTTPException(404, "远程应用尚未启用")
    return allowed


async def snapshot(request, response, principal, body=None):
    state = request.app.state
    allowed_apps(state)
    if state.cloud_setup is None:
        raise HTTPException(503, "云控配置协调器尚未就绪")
    response.headers["Cache-Control"] = "no-store"
    return await state.cloud_setup.run(request, principal.user_id, body)


def ice_servers(state, local):
    options = state.remote_settings
    return [] if local else turn_servers(options.apps_turn_urls, options.apps_turn_secret)


@router.get("", response_model=RemoteAppCatalog)
async def list_apps(request: Request, response: Response, principal: StudioAuth):
    value = await snapshot(request, response, principal)
    apps = {app.id: app for app in value.apps}
    return RemoteAppCatalog(apps=[apps[key] for key in value.allowed_ids if key in apps])


@router.get("/installed", response_model=InstalledRemoteApps)
async def installed(request: Request, response: Response, principal: StudioAuth):
    require_local_browser(request, principal)
    return await snapshot(request, response, principal)


@router.put("", response_model=InstalledRemoteApps)
async def save_apps(
    request: Request, response: Response, body: SaveRemoteApps, principal: StudioAuth
):
    require_local_browser(request, principal)
    require_recent_reauthentication(principal)
    return await snapshot(request, response, principal, body)


@router.post("/connect", response_model=RemoteAppHandshake)
async def connect(
    request: Request, response: Response, body: RemoteAppConnect, principal: StudioAuth
):
    state = request.app.state
    allowed_apps(state)
    if not state.auth_attempts.allow(f"remote-app:{principal.user_id}", 24):
        raise HTTPException(429, "连接尝试过多，请稍后重试")
    value = await snapshot(request, response, principal)
    if body.app_id not in value.allowed_ids or body.app_id not in allowed_apps(state):
        raise HTTPException(404, "应用不可用")
    if not any(app.id == body.app_id for app in value.apps):
        raise HTTPException(404, "应用已卸载或不可用")
    local = request.state.service_actor.local
    ticket = (
        state.app_sessions.issue(principal, local, body.app_id) if state.app_relay.ready else None
    )
    if ticket is None:
        raise HTTPException(503, "远程应用暂不可用")
    return RemoteAppHandshake(ticket=ticket, ice_servers=ice_servers(state, local))


@router.websocket("/socket")
async def app_socket(socket: WebSocket):
    state = socket.app.state
    assertion = socket.headers.get(HEADER, "")
    try:
        actor = verify_context(
            assertion,
            service="remote",
            method="GET",
            path=APP_SOCKET,
            public_key=state.identity_public_key,
        )
        origin = (
            state.remote_settings.local_origin
            if actor.local
            else state.remote_settings.public_origin
        )
        if (
            not origin
            or socket.headers.get("origin") != origin
            or "cookie" in socket.headers
            or "authorization" in socket.headers
            or actor.auth_kind != "session"
            or APP_PROTOCOL not in socket.scope["subprotocols"]
        ):
            raise ValueError("invalid remote app ingress")
        allowed_apps(state)
    except (HTTPException, TypeError, ValueError, jwt.InvalidTokenError):
        await socket.close(4403)
        return

    async def access(app_id):
        enabled, allowed = app_policy(state)
        if not enabled or not state.app_relay.ready or app_id not in allowed:
            return None
        current = await state.cloud_identity.cloud_authority(
            assertion=assertion, method="GET", path=APP_SOCKET
        )
        if current is None or not current.desktop_authorized:
            return None
        return (await state.desktop_preferences.read(owner=actor.user_id)).idle_minutes

    await socket.accept(subprotocol=APP_PROTOCOL)
    try:
        async with asyncio.timeout(5):
            hello = await read_message(socket)
        token = hello.get("ticket")
        ticket = (
            state.app_sessions.take(token, actor, actor.local) if isinstance(token, str) else None
        )
        if ticket is None or await access(ticket.app) is None:
            await socket.close(4403, "应用授权已失效")
            return
        async with state.app_relay.open(ticket.app) as relay:
            await relay_signaling(
                socket,
                send=relay.send,
                receive=relay.receive,
                access=lambda: access(ticket.app),
                ice_servers=[server.model_dump() for server in ice_servers(state, actor.local)],
            )
    except WebSocketDisconnect:
        pass
    except HTTPException as exc:
        with suppress(RuntimeError, OSError, WebSocketDisconnect):
            await socket.close(4410 if exc.status_code == 409 else 4411, "无法建立远程应用连接")
    except (TimeoutError, ValueError, OSError):
        with suppress(RuntimeError, OSError, WebSocketDisconnect):
            await socket.close(4411, "无法建立远程应用连接")
