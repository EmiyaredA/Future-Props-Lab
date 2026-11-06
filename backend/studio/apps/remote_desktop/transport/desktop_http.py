"""Remote status, idle settings, ticket issuance and authenticated Guacamole upgrade."""

from urllib.parse import urlsplit

import jwt
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket

from studio.apps.remote_desktop.use_cases.preferences import PreferenceConflict
from studio.assembly.identity_http import require_recent_reauthentication
from studio.config import ConfigurationError
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.cloud_authority import DESKTOP_COOKIE, DESKTOP_SOCKET, TICKET_SECONDS
from studio.contracts.remote_desktop.desktop import (
    CloudSetup,
    CloudSetupUpdate,
    CloudStatus,
    DesktopLogin,
    IdlePreference,
)
from studio.runtime.http.dependencies import StudioAuth
from studio.runtime.http.website import require_local_browser

router = APIRouter(prefix="/cloud-control", tags=["cloud-control"])


def remote_policy(state):
    try:
        return state.cloud_projection.read() if state.cloud_projection is not None else {}
    except ConfigurationError:
        raise HTTPException(503, "remote_cloud_projection_unavailable") from None


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
async def status(request: Request, principal: StudioAuth):
    current = await authority(request)
    preference = await request.app.state.desktop_preferences.read(owner=principal.user_id)
    state = request.app.state
    policy = remote_policy(state)
    happier_url = current.happier_studio_url if current.enabled else None
    happier_available = bool(
        happier_url and request.headers.get("host") == urlsplit(happier_url).netloc
    )
    return CloudStatus(
        enabled=current.enabled,
        host_label=policy.get("fpl_cloud_control_host_label", state.remote_settings.host_label),
        desktop_configured=current.desktop_configured,
        desktop_authorized=current.desktop_authorized,
        idle_minutes=preference.idle_minutes,
        idle_revision=preference.revision,
        local=request.state.service_actor.local,
        unlocked_until=current.unlocked_until,
        remote_apps_enabled=policy.get("fpl_cloud_control_apps_enabled", False),
        happier_available=happier_available,
        happier_studio_url=(
            f"{happier_url}/cloud-control?view=agent"
            if happier_url and not happier_available
            else None
        ),
    )


@router.put("/desktop/idle", response_model=IdlePreference)
async def save_idle(request: Request, body: IdlePreference, principal: StudioAuth):
    current = await authority(request)
    if not current.desktop_configured:
        raise HTTPException(403, "该账号或入口未启用云控操作")
    try:
        preference = await request.app.state.desktop_preferences.save(
            owner=principal.user_id, minutes=body.idle_minutes, revision=body.revision
        )
    except PreferenceConflict as error:
        raise HTTPException(
            409,
            {
                "code": "revision_conflict",
                "message": str(error),
                "current": {
                    "idle_minutes": error.current.idle_minutes,
                    "revision": error.current.revision,
                },
            },
        ) from None
    request.app.state.cloud_desktop.update_idle(principal.user_id)
    return IdlePreference(idle_minutes=preference.idle_minutes, revision=preference.revision)


@router.post("/desktop/connect", status_code=204)
async def connect(request: Request, body: DesktopLogin, principal: StudioAuth):
    if remote_policy(request.app.state).get("fpl_cloud_control_apps_enabled"):
        raise HTTPException(404, "请使用远程应用")
    current = await authority(request)
    if not current.desktop_authorized:
        raise HTTPException(
            403,
            detail={
                "code": "desktop_authorization_required",
                "message": "请先验证云控访问权限",
            },
        )
    if not request.app.state.auth_attempts.allow(f"cloud-vnc:{principal.user_id}", 8):
        raise HTTPException(429, "连接尝试过多，请稍后重试")
    local = request.state.service_actor.local
    ticket = request.app.state.cloud_desktop.issue(
        principal, local, body.password.get_secret_value()
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
        if remote_policy(socket.app.state).get("fpl_cloud_control_apps_enabled"):
            raise ValueError("desktop disabled while app windows are enabled")
        actor = verify_context(
            assertion,
            service="remote",
            method="GET",
            path=socket.url.path,
            public_key=socket.app.state.identity_public_key,
        )
    except (HTTPException, ValueError, TypeError, jwt.InvalidTokenError):
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
    )


@router.get("/settings", response_model=CloudSetup)
async def settings_view(request: Request, principal: StudioAuth):
    require_local_browser(request, principal)
    return await setup_snapshot(request, principal.user_id)


@router.put("/settings", response_model=CloudSetup)
async def settings_save(request: Request, body: CloudSetupUpdate, principal: StudioAuth):
    require_local_browser(request, principal)
    require_recent_reauthentication(principal)
    return await setup_snapshot(request, principal.user_id, body)


async def setup_snapshot(request, owner, body=None):
    setup = request.app.state.cloud_setup
    if setup is None:
        raise HTTPException(503, "云控配置协调器尚未就绪")
    value = await setup.run(request, owner, body)
    if value.remote_apps_enabled:
        return value
    return value.model_copy(update={"guacd_ready": await request.app.state.guacd_ready()})
