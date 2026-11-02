"""Only the separately authenticated gateway can attest the listening ingress."""

import secrets
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import PlainTextResponse


class GatewayTransport:
    def __init__(self, app, *, gateway_token, local_origin, public_origin, catalog):
        if len(gateway_token) < 32:
            raise ValueError("网关凭据强度不足")
        self.app = app
        self.token = gateway_token
        self.origins = {"local": urlsplit(local_origin), "public": urlsplit(public_origin)}
        self.catalog = catalog

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
        origin = self.origins.get(ingress)
        if (
            not origin
            or not secrets.compare_digest(headers.get("x-fpl-gateway", ""), self.token)
            or headers.get("host") != origin.netloc
            or headers.get("origin", origin.geturl()) != origin.geturl()
        ):
            await PlainTextResponse("Forbidden", 403)(scope, receive, send)
            return
        scope = dict(scope)
        scope["scheme"] = origin.scheme
        scope["state"] = {**scope.get("state", {}), "website_local": ingress == "local"}
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
