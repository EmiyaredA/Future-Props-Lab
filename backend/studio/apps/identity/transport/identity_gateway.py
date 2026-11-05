"""Only the separately authenticated gateway can attest the listening ingress."""

import secrets
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import PlainTextResponse

from studio.contracts.identity.session_policy import MANAGEMENT_SESSION, STUDIO_SESSION


class GatewayTransport:
    def __init__(
        self,
        app,
        *,
        gateway_token,
        local_origin,
        public_origin,
        catalog,
        management_gateway_token=None,
        management_local_origin="",
        management_public_origin="",
    ):
        if len(gateway_token) < 32:
            raise ValueError("网关凭据强度不足")
        self.app = app
        self.token = gateway_token
        self.origins = {"local": urlsplit(local_origin), "public": urlsplit(public_origin)}
        self.catalog = catalog
        if management_gateway_token is not None and (
            len(management_gateway_token) < 32
            or secrets.compare_digest(management_gateway_token, gateway_token)
        ):
            raise ValueError("管理网关必须使用独立强凭据")
        self.management_token = management_gateway_token
        self.management_origins = {
            "local": urlsplit(management_local_origin),
            "public": urlsplit(management_public_origin),
        }

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        headers = Headers(scope=scope)
        if path in {"/health", "/ready"} or path.startswith("/_internal/"):
            await self.app(scope, receive, send)
            return
        operation = self.catalog.match(scope.get("method", "GET"), path)
        if operation is None or operation.service != "identity":
            await PlainTextResponse("Not Found", 404)(scope, receive, send)
            return
        ingress = headers.get("x-fpl-ingress", "")
        management = self.management_token is not None and secrets.compare_digest(
            headers.get("x-fpl-gateway", ""), self.management_token
        )
        origins = self.management_origins if management else self.origins
        origin = origins.get(ingress)
        if (not management and path.startswith("/v1/platform/")) or (
            management and path == "/v1/auth/register"
        ):
            await PlainTextResponse("Not Found", 404)(scope, receive, send)
            return
        if (
            not origin
            or not secrets.compare_digest(
                headers.get("x-fpl-gateway", ""),
                (self.management_token if management else self.token),
            )
            or headers.get("host") != origin.netloc
            or headers.get("origin", origin.geturl()) != origin.geturl()
        ):
            await PlainTextResponse("Forbidden", 403)(scope, receive, send)
            return
        scope = dict(scope)
        scope["scheme"] = origin.scheme
        scope["state"] = {
            **scope.get("state", {}),
            "website_local": ingress == "local",
            "session_policy": MANAGEMENT_SESSION if management else STUDIO_SESSION,
        }
        scope["client"] = (headers.get("x-fpl-client-ip", ""), 0)

        async def no_cache(message):
            if message["type"] == "http.response.start":
                outgoing = MutableHeaders(scope=message)
                outgoing["Cache-Control"] = "no-store"
                if ingress == "public":
                    message["headers"] = [
                        (
                            name,
                            value + b"; Secure"
                            if name.lower() == b"set-cookie" and b"; secure" not in value.lower()
                            else value,
                        )
                        for name, value in message["headers"]
                    ]
            await send(message)

        await self.app(scope, receive, no_cache)
