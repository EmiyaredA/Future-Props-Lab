from fastapi import APIRouter, HTTPException, Request, Response, WebSocket

from studio.apps.identity.storage import cloud_access as access
from studio.apps.identity.transport.website.cloud_unlock import router as unlock_router
from studio.apps.remote_desktop.use_cases.preferences import PreferenceConflict
from studio.assembly.http_dependencies import (
    SessionDep,
    StudioAuth,
    require_recent_reauthentication,
    resolve_studio_websocket_principal,
)
from studio.assembly.website import cloud_setup as setup
from studio.assembly.website.happier import launch_router
from studio.assembly.website.remote_apps import router as apps_router
from studio.contracts.identity.cloud_authority import DESKTOP_COOKIE, DESKTOP_SOCKET
from studio.contracts.remote_desktop.desktop import (
    CloudSetup,
    CloudSetupUpdate,
    CloudStatus,
    DesktopLogin,
    IdlePreference,
)
from studio.runtime.http.website import require_local_browser

router = APIRouter(prefix="/cloud-control", tags=["cloud-control"])


def local_request(request):
    return getattr(request.state, "website_local", False)


@router.get("/status", response_model=CloudStatus)
async def status(request: Request, response: Response, db: SessionDep, principal: StudioAuth):
    response.headers["Cache-Control"] = "no-store"
    settings = request.app.state.read_cloud_settings()
    local = local_request(request)
    agent_local = local or getattr(request.state, "website_happier_local", False)
    enabled = access.allowed(principal, local=agent_local, settings=settings)
    preference = await request.app.state.desktop_preferences.read(owner=principal.user_id)
    happier = request.app.state.happier
    happier_available = bool(enabled and happier and happier.available(request, principal))
    return CloudStatus(
        enabled=enabled,
        host_label=settings.fpl_cloud_control_host_label,
        desktop_configured=access.allowed(principal, local=local, desktop=True, settings=settings),
        desktop_authorized=await access.desktop_authorized(
            db, principal, local=local, settings=settings
        ),
        idle_minutes=preference.idle_minutes,
        idle_revision=preference.revision,
        remote_apps_enabled=settings.fpl_cloud_control_apps_enabled,
        local=local,
        unlocked_until=await access.unlock_expiry(
            db, principal, local=agent_local, settings=settings
        ),
        happier_available=happier_available,
        happier_studio_url=(
            happier.studio_origin + "/cloud-control?view=agent"
            if local and happier and happier.eligible(principal) and not happier_available
            else None
        ),
    )


@router.put("/desktop/idle", response_model=IdlePreference)
async def save_idle(request: Request, body: IdlePreference, principal: StudioAuth):
    access.require_enabled(
        principal,
        local=local_request(request),
        desktop=True,
        settings=request.app.state.read_cloud_settings(),
    )
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
async def connect(request: Request, body: DesktopLogin, db: SessionDep, principal: StudioAuth):
    if request.app.state.read_cloud_settings().fpl_cloud_control_apps_enabled:
        raise HTTPException(404, "请使用远程应用")
    local = local_request(request)
    settings = request.app.state.read_cloud_settings()
    if not await access.desktop_authorized(db, principal, local=local, settings=settings):
        raise HTTPException(
            403,
            detail={
                "code": "desktop_authorization_required",
                "message": "请先验证云控访问权限",
            },
        )
    if not request.app.state.auth_attempts.allow(f"cloud-vnc:{principal.user_id}", 8):
        raise HTTPException(429, "连接尝试过多，请稍后重试")
    ticket = request.app.state.cloud_desktop.issue(
        principal, local, body.password.get_secret_value()
    )
    if ticket is None:
        raise HTTPException(503, "桌面连接暂不可用")
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.set_cookie(
        DESKTOP_COOKIE,
        ticket,
        max_age=access.TICKET_SECONDS,
        path=DESKTOP_SOCKET,
        httponly=True,
        secure=not local_request(request),
        samesite="strict",
    )
    return response


@router.websocket("/desktop/socket")
async def desktop_socket(socket: WebSocket):
    local = local_request(socket)
    settings = socket.app.state.read_cloud_settings()
    if settings.fpl_cloud_control_apps_enabled:
        await socket.close(4403)
        return
    local_origins = {"http://127.0.0.1:3000", f"http://127.0.0.1:{settings.fpl_website_port}"}
    origins = local_origins if local else {settings.fpl_remote_web_origin}
    if (
        socket.headers.get("origin") not in origins
        or "guacamole" not in socket.scope["subprotocols"]
    ):
        await socket.close(4403)
        return
    try:
        principal = await resolve_studio_websocket_principal(socket, "cloud-control.access")
    except HTTPException:
        await socket.close(4403)
        return
    if not access.allowed(principal, local=local, desktop=True, settings=settings):
        await socket.close(4403)
        return
    await socket.app.state.cloud_desktop.connect(socket, principal, local)


@router.get("/settings", response_model=CloudSetup)
async def settings_view(request: Request, principal: StudioAuth):
    require_local_browser(request, principal)
    return await setup.read_setup(principal)


@router.put("/settings", response_model=CloudSetup)
async def settings_save(request: Request, body: CloudSetupUpdate, principal: StudioAuth):
    require_local_browser(request, principal)
    require_recent_reauthentication(principal)
    return await setup.save_setup(principal, body)


router.include_router(unlock_router)
router.include_router(launch_router)
router.include_router(apps_router)
