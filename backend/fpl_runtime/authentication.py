"""Verify destination-bound Identity assertions before opening application business state."""

import jwt
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse

from .approved_request_body import verified_receive
from .claims import HEADER, verify_request_context


class SignedIdentity:
    def __init__(self, app, *, service, public_key, catalog):
        self.app, self.service, self.key, self.catalog = app, service, public_key, catalog

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] in {"/health", "/ready"}:
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        if not path.startswith("/v1/"):
            await self.app(scope, receive, send)
            return
        operation = self.catalog.match(scope["method"], path)
        if operation is None or operation.service != self.service:
            await JSONResponse({"code": "not_found"}, 404, headers={"Cache-Control": "no-store"})(
                scope, receive, send
            )
            return
        token = Headers(scope=scope).get(HEADER, "")
        try:
            actor, checksum = verify_request_context(
                token,
                service=self.service,
                method=scope["method"],
                path=path,
                public_key=self.key,
            )
        except (jwt.InvalidTokenError, TypeError, ValueError):
            await JSONResponse(
                {"code": "studio_auth_required"},
                401,
                headers={"Cache-Control": "no-store"},
            )(scope, receive, send)
            return
        if checksum is not None:
            receive = await verified_receive(scope, receive, send, checksum)
            if receive is None:
                return
        scope = dict(scope)
        scope["state"] = {
            **scope.get("state", {}),
            "service_actor": actor,
            "service_assertion": token,
            "website_local": actor.local,
        }

        async def private_response(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, private_response)
