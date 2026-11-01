"""Opt-in HTTPS browser ingress on a distinct loopback socket, sharing one runtime."""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse, PlainTextResponse


class RemoteWeb:
    def __init__(self, *, origin: str, port: int, static, authenticate, secure_cookies=True):
        self.origin = origin
        self.host = urlsplit(origin).netloc
        self.port = port
        self.static = static
        self.authenticate = authenticate
        self.secure_cookies = secure_cookies

    def accepts(self, scope) -> bool:
        # This is the bound socket identity, never a client-controlled header.
        return scope.get("server") == ("127.0.0.1", self.port)

    async def __call__(self, app, scope, receive, send):
        headers = Headers(scope=scope)
        path = scope["path"]
        websocket = scope["type"] == "websocket"
        unsafe = scope.get("method", "GET") not in {"GET", "HEAD", "OPTIONS"}

        async def reject(status, message):
            if websocket:
                await send({"type": "websocket.close", "code": 1008})
            else:
                await PlainTextResponse(message, status_code=status)(scope, receive, send)

        if headers.get("host") != self.host or (
            (unsafe or websocket) and headers.get("origin") != self.origin
        ):
            await reject(403, "Forbidden")
            return
        if (
            path == "/v1/desktop"
            or path.startswith("/v1/desktop/")
            or path in {"/docs", "/redoc", "/openapi.json", "/v1/auth/register"}
            or path.startswith("/v1/auth/register/")
            or ".." in path.split("/")
            or "\\" in path
            or "//" in path
        ):
            await reject(404, "Not Found")
            return
        if websocket and path != "/v1/model-test/realtime":
            await reject(404, "Not Found")
            return

        scope = dict(scope)
        scope["scheme"] = (
            ("wss" if self.secure_cookies else "ws")
            if websocket
            else ("https" if self.secure_cookies else "http")
        )
        scope["headers"] = [
            (name, value)
            for name, value in scope["headers"]
            if not name.lower().startswith((b"x-fpl-", b"x-forwarded-", b"x-auth-"))
            and name.lower() not in {b"forwarded", b"x-remote-control-proxy"}
        ]

        async def protected_send(message):
            if message["type"] == "http.response.start":
                message = dict(message)
                response_headers = []
                for name, value in message.get("headers", []):
                    if name.lower() == b"cache-control":
                        continue
                    if (
                        self.secure_cookies
                        and name.lower() == b"set-cookie"
                        and value.split(b"=", 1)[0]
                        in {
                            b"fpl_session",
                            b"fpl_csrf",
                        }
                    ):
                        if b"secure" not in [p.strip().lower() for p in value.split(b";")[1:]]:
                            value += b"; Secure"
                    response_headers.append((name, value))
                policy = "no-store"
                if not path.startswith(("/v1/", "/health", "/ready")) and message["status"] in {
                    200,
                    304,
                }:
                    policy = (
                        "public, max-age=31536000, immutable"
                        if re.search(r"/assets/[^/]+-[\w-]{8,}\.", path)
                        else "public, max-age=3600, must-revalidate"
                    )
                    if not path.rsplit("/", 1)[-1].count(".") or path.endswith(
                        (".html", "/build.json")
                    ):
                        policy = "no-cache"
                response_headers.append((b"cache-control", policy.encode()))
                message["headers"] = response_headers
            await send(message)

        if path.startswith("/v1/"):
            if not websocket and path != "/v1/auth/login":
                # Reuse real account/session validation, including expiry, revocation,
                # CSRF and account binding. Route-specific permissions still run.
                try:
                    await self.authenticate(scope, receive)
                except HTTPException as exc:
                    await JSONResponse(
                        {"detail": exc.detail},
                        status_code=exc.status_code,
                        headers=exc.headers,
                    )(scope, receive, protected_send)
                    return
            await app(scope, receive, protected_send)
        elif path in {"/health", "/ready"}:
            await app(scope, receive, protected_send)
        elif websocket:
            await reject(404, "Not Found")
        else:
            try:
                await self.static(scope, receive, protected_send)
            except StarletteHTTPException as exc:
                await PlainTextResponse("Not Found", status_code=exc.status_code)(
                    scope, receive, protected_send
                )
