"""Bind Happier grants to the compatibility site's existing cloud authority."""

from fastapi import APIRouter, HTTPException, Request, Response

from studio.apps.identity.storage.cloud_access import unlock_expiry
from studio.apps.identity.use_cases.happier_access import EXCHANGE_PATH, HappierAccess
from studio.assembly.http_dependencies import StudioAuth
from studio.assembly.website.happier_ingress import HappierIngress
from studio.contracts.identity.happier import HappierLaunch

launch_router = APIRouter()


class Happier:
    def __init__(self, settings, sessions, *, read_cloud_settings):
        self.studio_origin = settings.fpl_remote_web_origin
        self.admin_user_id = settings.fpl_happier_admin_user_id
        self.sessions = sessions
        self.read_cloud_settings = read_cloud_settings
        self.access = HappierAccess(
            origin=settings.fpl_happier_origin,
            authorize_grant=self.authorize_grant,
        )
        self.relay_port = settings.fpl_happier_relay_port

    def ingress(self):
        return HappierIngress(
            self.access, studio_origin=self.studio_origin, relay_port=self.relay_port
        )

    def eligible(self, principal):
        return (
            principal.auth_kind == "session"
            and principal.user_id == self.admin_user_id
            and principal.is_platform_admin
        )

    def available(self, request, principal):
        return (
            self.eligible(principal)
            and f"{request.url.scheme}://{request.url.netloc}" == self.studio_origin
        )

    async def expiry(self, principal, local):
        if principal.user_id != self.admin_user_id:
            return 0
        async with self.sessions() as db:
            return await unlock_expiry(
                db, principal, local=local, settings=self.read_cloud_settings()
            )

    async def authorize_grant(self, grant):
        return bool(await self.expiry(grant.principal, grant.local))


@launch_router.post("/happier/launch", response_model=HappierLaunch)
async def launch_happier(request: Request, response: Response, principal: StudioAuth):
    response.headers["Cache-Control"] = "no-store"
    happier = request.app.state.happier
    if happier is None or not happier.available(request, principal):
        raise HTTPException(403, "该账号或入口未启用 Happier")
    local = getattr(request.state, "website_local", False)
    expires = await happier.expiry(principal, local)
    if not expires:
        raise HTTPException(403, "请先验证管理员密码")
    ticket = happier.access.launch(principal, local, expires)
    if ticket is None:
        raise HTTPException(429, "Happier 启动请求过多，请稍后重试")
    return HappierLaunch(exchange_url=happier.access.origin + EXCHANGE_PATH, ticket=ticket)
