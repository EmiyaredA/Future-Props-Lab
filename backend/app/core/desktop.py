"""Desktop-only transport and static hosting; no business data access."""

from __future__ import annotations

import secrets
from pathlib import Path

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import PlainTextResponse
from starlette.staticfiles import StaticFiles

from app.accounts.desktop_agent import AgentError, DesktopAgent, allows_agent

DESKTOP_HEADER = "x-fpl-desktop-token"


class DesktopTransport:
    def __init__(self, app, *, token: str):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope["type"] in {"http", "websocket"}:
            headers = Headers(scope=scope)
            supplied = headers.get(DESKTOP_HEADER, "")
            origin = headers.get("origin")
            server = scope.get("server")
            expected_host = (
                f"127.0.0.1:{server[1]}" if server and server[0] == "127.0.0.1" else None
            )
            invalid_origin = origin is not None and origin != f"http://{headers.get('host', '')}"
            invalid_host = expected_host is not None and headers.get("host") != expected_host
            is_agent = headers.get("x-fpl-agent-channel") == "1"
            invalid_agent = is_agent and (
                scope["type"] != "http"
                or bool(headers.get("cookie"))
                or not allows_agent(scope.get("method", ""), scope["path"])
            )
            if (
                not secrets.compare_digest(supplied.encode(), self.token.encode())
                or invalid_origin
                or invalid_host
                or invalid_agent
            ):
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await PlainTextResponse("Forbidden", status_code=403)(scope, receive, send)
                return
        async def observe(message):
            if (scope["type"] == "http" and message["type"] == "http.response.start"
                and 200 <= message["status"] < 300
                and Headers(scope=scope).get("x-fpl-agent-channel") == "1"
                and scope["method"] not in {"GET", "HEAD"}
                and not scope["path"].startswith("/v1/desktop/")):
                principal = scope.get("state", {}).get("studio_principal")
                if principal:
                    changes = scope["app"].state.desktop_agent.changes
                    audience = (principal.user_id, principal.workspace_id)
                    changes[audience] = changes.get(audience, 0) + 1
            await send(message)

        await self.app(scope, receive, observe)


class DesktopStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        # API typos must never become successful HTML responses.
        if path.split("/", 1)[0] in {"v1", "health", "ready"}:
            raise HTTPException(404)
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if (
                exc.status_code == 404
                and scope["method"] in {"GET", "HEAD"}
                and "text/html" in Headers(scope=scope).get("accept", "")
                and not Path(path).suffix
                and path.split("/", 1)[0] not in {"assets", "brand", "docs", "voice-vad"}
                and ".." not in Path(path).parts
            ):
                return await super().get_response("index.html", scope)
            raise


def attach_desktop(app, *, token: str, web_root: Path) -> None:
    if len(token) < 32:
        raise ValueError("桌面启动凭据无效")
    if not (web_root / "index.html").is_file():
        raise ValueError("应用页面资源缺失，请重新安装")
    app.state.desktop_enabled = True
    app.state.desktop_agent = DesktopAgent()

    async def agent_error(_request, exc):
        from starlette.responses import JSONResponse

        return JSONResponse({"code": exc.code, "message": exc.code}, status_code=exc.status)

    app.add_exception_handler(AgentError, agent_error)
    app.add_middleware(DesktopTransport, token=token)
    app.mount("/", DesktopStaticFiles(directory=web_root, html=True), name="desktop-web")
