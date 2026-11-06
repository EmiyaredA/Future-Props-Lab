"""Browser-only Happier ingress. The CLI daemon connects to the private relay directly."""

from __future__ import annotations

import asyncio
import base64
import binascii
from urllib.parse import parse_qsl, unquote_plus, urlsplit

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import (
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocketDisconnect
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from studio.apps.identity.use_cases.happier_oidc import BROWSER_COOKIE, EXCHANGE_PATH, OIDC_PATH

DISCOVERY = "/.well-known/openid-configuration"
UPDATES = "/v1/updates"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
REQUEST_HEADERS = {
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "content-length",
    "range",
    "origin",
    "user-agent",
}
RESPONSE_HEADERS = {
    "content-type",
    "content-disposition",
    "content-length",
    "content-encoding",
    "content-range",
    "accept-ranges",
    "location",
    "content-security-policy",
}


class HappierIngress:
    def __init__(self, identity, *, studio_origin, relay_port):
        self.identity = identity
        self.studio_origin = studio_origin
        self.host = urlsplit(identity.origin).netloc
        self.upstream = f"http://127.0.0.1:{relay_port}"
        self.socket_url = f"ws://127.0.0.1:{relay_port}"
        self.client = httpx.AsyncClient(trust_env=False)
        self.app = Starlette(
            routes=[
                Route(EXCHANGE_PATH, self.exchange, methods=["POST"]),
                Route(OIDC_PATH + DISCOVERY, self.discovery),
                Route(DISCOVERY + OIDC_PATH, self.discovery),
                Route(OIDC_PATH + "/jwks", self.jwks),
                Route(OIDC_PATH + "/authorize", self.authorize),
                Route(OIDC_PATH + "/token", self.token, methods=["POST"]),
                WebSocketRoute(UPDATES, self.updates),
                WebSocketRoute(UPDATES + "/", self.updates),
                Route(
                    "/{path:path}",
                    self.forward,
                    methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                ),
            ]
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return
        host = [value for key, value in scope["headers"] if key == b"host"]
        if host != [self.host.encode()]:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await PlainTextResponse("Forbidden", 403)(scope, receive, send)
            return

        async def protect(message):
            if message["type"] == "http.response.start":
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key not in {b"cache-control", b"referrer-policy"}
                ]
                headers.extend(
                    [
                        (b"cache-control", b"no-store"),
                        (b"referrer-policy", b"strict-origin"),
                        (
                            b"content-security-policy",
                            f"frame-ancestors {self.studio_origin}".encode(),
                        ),
                        (b"x-content-type-options", b"nosniff"),
                    ]
                )
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, protect)

    async def current_grant(self, connection):
        grant = self.identity.browser_grant(connection.cookies.get(BROWSER_COOKIE))
        return grant if grant and await self.identity.allowed(grant) else None

    async def exchange(self, request):
        if request.headers.get("origin") != self.studio_origin:
            return PlainTextResponse("Forbidden", 403)
        headers = {
            "Access-Control-Allow-Origin": self.studio_origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
        form = await small_form(request)
        grant = self.identity.launches.redeem(form.get("ticket", ""))
        if not grant or not await self.identity.allowed(grant):
            return PlainTextResponse("云控授权已过期，请回到工作台重试。", 403, headers=headers)
        response = Response(status_code=204, headers=headers)
        response.set_cookie(
            BROWSER_COOKIE,
            self.identity.cookie(grant),
            max_age=max(0, grant.expires - int(self.identity.clock())),
            httponly=True,
            secure=True,
            samesite="strict",
        )
        return response

    async def discovery(self, _request):
        return JSONResponse(self.identity.discovery())

    async def jwks(self, _request):
        return JSONResponse(self.identity.jwks())

    async def authorize(self, request):
        grant = await self.current_grant(request)
        if not grant:
            return PlainTextResponse("请从 FPL 云控打开 Happier。", 403)
        target = self.identity.authorize(grant, request.query_params)
        return RedirectResponse(target, 302) if target else oauth_error("invalid_request")

    async def token(self, request):
        params = await small_form(request)
        client_id, secret = client_credentials(request, params)
        if not self.identity.client_authenticated(client_id, secret):
            return oauth_error("invalid_client", 401)
        token = await self.identity.token(params)
        return JSONResponse(token) if token else oauth_error("invalid_grant")

    async def forward(self, request):
        if (
            request.method not in SAFE_METHODS
            and request.headers.get("origin") != self.identity.origin
        ):
            return PlainTextResponse("Forbidden", 403)
        grant = await self.current_grant(request)
        if not grant:
            return PlainTextResponse("请从 FPL 云控打开 Happier。", 403)
        upstream = raw_target(self.upstream, request.scope)
        if upstream is None:
            return PlainTextResponse("Bad Request", 400)
        headers = [(key, value) for key, value in request.headers.items() if key in REQUEST_HEADERS]
        polling = request.url.path.rstrip("/") == UPDATES
        outgoing = self.client.build_request(
            request.method,
            upstream,
            headers=headers,
            content=request.stream() if request.method not in SAFE_METHODS else None,
            timeout=httpx.Timeout(5, read=40) if polling else httpx.Timeout(5),
        )
        # Browser and ingress cookies are never part of the Relay protocol.
        outgoing.headers.pop("cookie", None)
        try:
            result = await self.client.send(outgoing, stream=True)
        except httpx.HTTPError:
            return PlainTextResponse("Happier 暂不可用。", 502)
        if polling and not await self.identity.allowed(grant):
            await result.aclose()
            return PlainTextResponse("云控授权已过期。", 403)

        async def content():
            try:
                async for chunk in result.aiter_raw():
                    yield chunk
            finally:
                await result.aclose()

        response = StreamingResponse(content(), status_code=result.status_code)
        response.raw_headers = [
            (key, value)
            for key, value in result.headers.raw
            if key.decode().lower() in RESPONSE_HEADERS
        ]
        return response

    async def updates(self, socket):
        grant = await self.current_grant(socket)
        target = raw_target(self.socket_url, socket.scope)
        if socket.headers.get("origin") != self.identity.origin or not grant or not target:
            await socket.close(1008)
            return
        try:
            async with connect(
                str(target),
                origin=self.identity.origin,
                proxy=None,
                open_timeout=5,
                close_timeout=1,
                max_size=8 * 1024 * 1024,
            ) as upstream:
                await socket.accept()
                await relay_updates(socket, upstream, self.identity, grant)
        except (OSError, TimeoutError, WebSocketException):
            await socket.close(1011)
        except WebSocketDisconnect:
            pass


async def relay_updates(socket, upstream, identity, grant):
    async def read_browser():
        while True:
            frame = await socket.receive()
            if frame["type"] == "websocket.disconnect":
                return
            await upstream.send(frame["text"] if frame.get("text") is not None else frame["bytes"])

    async def read_relay():
        async for frame in upstream:
            if isinstance(frame, str):
                await socket.send_text(frame)
            else:
                await socket.send_bytes(frame)
        await socket.close(1000)

    async def watch_access():
        while await identity.allowed(grant):
            await asyncio.sleep(min(2, max(0, grant.expires - identity.clock())))
        await socket.close(1008)

    tasks = [asyncio.create_task(run()) for run in (read_browser, read_relay, watch_access)]
    try:
        done, _pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def raw_target(base, scope):
    path = scope["path"]
    if "//" in path or "\\" in path or any(part in {".", ".."} for part in path.split("/")):
        return None
    raw = scope.get("raw_path", path.encode())
    query = scope.get("query_string", b"")
    return httpx.URL(base).copy_with(raw_path=raw + (b"?" + query if query else b""))


async def small_form(request: Request):
    if request.headers.get("content-type", "").split(";")[0] != "application/x-www-form-urlencoded":
        return {}
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 8192:
            return {}
    try:
        pairs = parse_qsl(body.decode(), keep_blank_values=True, max_num_fields=12)
    except (UnicodeDecodeError, ValueError):
        return {}
    return dict(pairs) if len(dict(pairs)) == len(pairs) else {}


def client_credentials(request, params):
    header = request.headers.get("authorization", "")
    if not header:
        return params.get("client_id", ""), params.get("client_secret", "")
    scheme, _, encoded = header.partition(" ")
    if scheme.lower() != "basic" or len(encoded) > 8192:
        return "", ""
    try:
        client_id, separator, secret = (
            base64.b64decode(encoded, validate=True).decode().partition(":")
        )
    except (binascii.Error, UnicodeDecodeError):
        return "", ""
    if not separator or "client_secret" in params:
        return "", ""
    return unquote_plus(client_id), unquote_plus(secret)


def oauth_error(error, status=400):
    return JSONResponse({"error": error}, status)
