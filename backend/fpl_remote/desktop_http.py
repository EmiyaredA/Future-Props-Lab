"""Remote status, idle settings, ticket issuance and authenticated Guacamole upgrade."""

import jwt
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket

from app.capabilities.identity.rate_limit import allow_attempt
from app.console.cloud_control import preferences
from app.console.cloud_control.schemas import (
    CloudSetup,
    CloudSetupUpdate,
    CloudStatus,
    DesktopLogin,
    IdlePreference,
)
from app.runtime.website import require_local_browser
from fpl_config import ConfigurationError
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.cloud_authority import DESKTOP_COOKIE, DESKTOP_SOCKET, TICKET_SECONDS
from fpl_runtime.http_dependencies import SessionDep, StudioAuth

router = APIRouter(prefix="/cloud-control", tags=["cloud-control"])


async def authority(request):
    result = await request.app.state.cloud_identity.cloud_authority(
        assertion=request.state.service_assertion,
        method=request.method,
        path=request.url.path,
    )
    if result is None:
        raise HTTPException(503, "云控身份服务暂不可用")
    if not result.active:
        raise HTTPException(403, "云控会话已失效")
    return result


@router.get("/status", response_model=CloudStatus)
async def status(request: Request, db: SessionDep, principal: StudioAuth):
    current = await authority(request)
    minutes, revision = await preferences.desktop_preferences(db, principal.user_id)
    state = request.app.state
    label = state.remote_settings.host_label
    if state.cloud_projection is not None:
        try:
            label = state.cloud_projection.read()["fpl_cloud_control_host_label"]
        except ConfigurationError:
            raise HTTPException(503, "remote_cloud_projection_unavailable") from None
    return CloudStatus(
        enabled=current.enabled,
        host_label=label,
        desktop_configured=current.desktop_configured,
        desktop_authorized=current.desktop_authorized,
        idle_minutes=minutes,
        idle_revision=revision,
        local=request.state.service_actor.local,
        enrolled=current.enrolled,
        unlocked_until=current.unlocked_until,
    )


@router.put("/desktop/idle", response_model=IdlePreference)
async def save_idle(request: Request, body: IdlePreference, db: SessionDep, principal: StudioAuth):
    current = await authority(request)
    if not current.desktop_configured:
        raise HTTPException(403, "该账号或入口未启用云控操作")
    minutes, revision = await preferences.save_desktop_preferences(db, principal.user_id, body)
    request.app.state.cloud_desktop.update_idle(principal.user_id)
    return IdlePreference(idle_minutes=minutes, revision=revision)


@router.post("/desktop/connect", status_code=204)
async def connect(request: Request, body: DesktopLogin, principal: StudioAuth):
    current = await authority(request)
    if not current.desktop_authorized:
        raise HTTPException(
            403,
            detail={
                "code": "desktop_authorization_required",
                "message": "请先验证云控访问权限",
            },
        )
    if not allow_attempt(f"cloud-vnc:{principal.user_id}", 8):
        raise HTTPException(429, "连接尝试过多，请稍后重试")
    local = request.state.service_actor.local
    ticket = request.app.state.cloud_desktop.issue(
        principal, local, body.password.get_secret_value(), epoch=current.factor_epoch
    )
    if ticket is None:
        raise HTTPException(503, "桌面连接暂不可用")
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.set_cookie(
        DESKTOP_COOKIE,
        ticket,
        max_age=TICKET_SECONDS,
        path=DESKTOP_SOCKET,
        httponly=True,
        secure=not local,
        samesite="strict",
    )
    return response


@router.websocket("/desktop/socket")
async def desktop_socket(socket: WebSocket):
    assertion = socket.headers.get(HEADER, "")
    try:
        actor = verify_context(
            assertion,
            service="remote",
            method="GET",
            path=socket.url.path,
            public_key=socket.app.state.identity_public_key,
        )
    except (ValueError, TypeError, jwt.InvalidTokenError):
        await socket.close(4403)
        return
    options = socket.app.state.remote_settings
    origin = options.local_origin if actor.local else options.public_origin
    if (
        not origin
        or socket.headers.get("origin") != origin
        or "cookie" in socket.headers
        or "authorization" in socket.headers
        or "guacamole" not in socket.scope["subprotocols"]
    ):
        await socket.close(4403)
        return
    current = await socket.app.state.cloud_identity.cloud_authority(
        assertion=assertion, method="GET", path=DESKTOP_SOCKET
    )
    if current is None or not current.desktop_authorized:
        await socket.close(4403)
        return
    await socket.app.state.cloud_desktop.connect(
        socket,
        actor,
        actor.local,
        proof=actor.desktop_ticket_sha256,
        context=assertion,
        epoch=current.factor_epoch,
    )


@router.get("/settings", response_model=CloudSetup)
async def settings_view(request: Request, principal: StudioAuth):
    require_local_browser(request, principal)
    return await setup_snapshot(request, principal.user_id)


@router.put("/settings", response_model=CloudSetup)
async def settings_save(request: Request, body: CloudSetupUpdate, principal: StudioAuth):
    require_local_browser(request, principal)
    return await setup_snapshot(request, principal.user_id, body)


async def setup_snapshot(request, owner, body=None):
    setup = request.app.state.cloud_setup
    if setup is None:
        raise HTTPException(503, "云控配置协调器尚未就绪")
    value = await setup.run(request, owner, body)
    return value.model_copy(update={"guacd_ready": await request.app.state.guacd_ready()})
