"""Cloud Control operations owned by the independent gateway."""

from fastapi import APIRouter, HTTPException, Request
from starlette.datastructures import Headers

from studio.apps.gateway.transport.happier_ingress import HappierIngress
from studio.apps.gateway.use_cases.happier_access import HappierAccess
from studio.contracts.identity.happier import EXCHANGE_PATH, LAUNCH_PATH, HappierLaunch
from studio.runtime.http.dependencies import StudioAuth

router = APIRouter()


class LocalHappier:
    def __init__(self, *, studio_origin, origin, relay_port, identity):
        self.studio_origin = studio_origin
        self.identity = identity
        self.access = HappierAccess(origin=origin, authorize_grant=self.authorized)
        self.ingress = HappierIngress(
            self.access,
            studio_origin=studio_origin,
            relay_port=relay_port,
            relay_host="host.docker.internal",
        )

    async def authority(self, proof):
        return await self.identity.cloud_authority(assertion=proof, method="POST", path=LAUNCH_PATH)

    async def authorized(self, grant):
        if not grant.local or not grant.proof:
            return False
        current = await self.authority(grant.proof)
        return bool(current and current.active and current.unlocked_until > self.access.clock())

    async def close(self):
        await self.ingress.client.aclose()
        await self.identity.close()


class LocalHappierIngress:
    def __init__(self, app, *, happier):
        self.app = app
        self.ingress = happier.ingress

    async def __call__(self, scope, receive, send):
        if scope["type"] in {"http", "websocket"} and (
            Headers(scope=scope).get("host") == self.ingress.host
        ):
            await self.ingress(scope, receive, send)
            return
        await self.app(scope, receive, send)


@router.post(LAUNCH_PATH.removeprefix("/v1"), response_model=HappierLaunch)
async def launch_happier(request: Request, principal: StudioAuth):
    happier = request.app.state.happier
    if (
        not happier
        or not request.state.service_actor.local
        or not principal.is_platform_admin
        or request.headers.get("origin") != happier.studio_origin
    ):
        raise HTTPException(403, "该账号或入口未启用 Happier")
    proof = request.state.service_assertion
    current = await happier.authority(proof)
    if current is None:
        raise HTTPException(503, "云控身份服务暂不可用")
    if not current.active:
        raise HTTPException(403, "该账号或入口未启用 Happier")
    if current.unlocked_until <= happier.access.clock():
        raise HTTPException(403, "请先验证管理员密码")
    ticket = happier.access.launch(principal, True, current.unlocked_until, proof=proof)
    if ticket is None:
        raise HTTPException(429, "Happier 启动请求过多，请稍后重试")
    return HappierLaunch(exchange_url=happier.access.origin + EXCHANGE_PATH, ticket=ticket)
