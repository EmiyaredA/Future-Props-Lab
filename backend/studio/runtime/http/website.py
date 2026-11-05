"""Trusted website ingress and SPA hosting, independent of any native shell."""

import asyncio
import fcntl
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import HTMLResponse, PlainTextResponse
from starlette.staticfiles import StaticFiles

from studio.runtime.http.path_patterns import path_pattern
from studio.runtime.http.website_releases import retired_releases

HASHED_ASSET = re.compile(r"/assets/(?:[\w.-]+/)*[\w.-]+-[\w-]{8,}\.[\w.-]+", re.ASCII)


@contextmanager
def pin_release(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        if not path.is_dir():
            raise FileNotFoundError(path)
        yield
    finally:
        os.close(descriptor)


def listed_asset(release, asset):
    try:
        manifest = json.loads((release / "manifest.json").read_text())
        return manifest["build_id"] == release.name and any(
            entry["path"] == asset for entry in manifest["files"]
        )
    except (OSError, ValueError, TypeError, KeyError):
        return False


class WebsiteStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        if path.split("/", 1)[0] in {"v1", "health", "ready"}:
            raise StarletteHTTPException(404)
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
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


class BuildStaticFiles(WebsiteStaticFiles):
    def file_response(self, full_path, stat_result, scope, status_code=200):
        path = Path(full_path)
        if path.suffix == ".html" and path.parent == Path(self.directory):
            build_id = json.loads(path.with_name("build.json").read_text())["build_id"]
            html = path.read_text().replace(
                "</head>", f'<meta name="fpl-build" content="{build_id}" />\n</head>', 1
            )
            return HTMLResponse(
                "" if scope["method"] == "HEAD" else html,
                headers={"Cache-Control": "no-cache", "Content-Length": str(len(html.encode()))},
            )
        response = super().file_response(full_path, stat_result, scope, status_code)
        if path.name in {"build.json", "manifest.json"}:
            response.headers["Cache-Control"] = "no-cache"
        return response


class CurrentWebsite:
    """Serve current pages and allow retained releases to supply hashed assets."""

    def __init__(self, directory):
        self.directory = directory

    async def __call__(self, scope, receive, send):
        while True:
            active = self.directory.resolve()
            try:
                with pin_release(active):
                    await BuildStaticFiles(directory=active, html=True)(scope, receive, send)
                    return
            except StarletteHTTPException as exc:
                if exc.status_code != 404 or not await self.retired_asset(scope, receive, send):
                    raise
                return
            except (FileNotFoundError, BlockingIOError):
                if active == self.directory.resolve():
                    raise
                await asyncio.sleep(0)

    async def retired_asset(self, scope, receive, send):
        path = scope["path"]
        if scope["method"] not in {"GET", "HEAD"} or not HASHED_ASSET.fullmatch(path):
            return False
        if any(part.startswith(".") for part in path[1:].split("/")):
            return False
        builds = self.directory.parent / "builds"
        retained, _ = retired_releases(self.directory.resolve(), builds)
        for release in retained:
            try:
                with pin_release(release):
                    # Recheck eligibility after pinning. Collection can run during lookup.
                    current, _ = retired_releases(self.directory.resolve(), builds)
                    if release not in current or not await asyncio.to_thread(
                        listed_asset, release, path[1:]
                    ):
                        continue
                    await WebsiteStaticFiles(directory=release)(scope, receive, send)
                    return True
            except (FileNotFoundError, BlockingIOError):
                continue
            except StarletteHTTPException as exc:
                if exc.status_code != 404:
                    raise
        return False


def require_local_browser(request: Request, principal) -> None:
    if not getattr(request.state, "website_local", False):
        raise HTTPException(403, detail="此操作仅支持本机网站入口")
    if principal.auth_kind != "session":
        raise HTTPException(403, detail="browser_session_required")


class WebsiteTransport:
    def __init__(
        self,
        app,
        *,
        local_port: int,
        frontend_origin=None,
        frontend_port=None,
        public_access=None,
        automation_policy=None,
    ):
        self.app, self.local_port, self.public_access = app, local_port, public_access
        self.automation_policy = automation_policy
        if frontend_origin not in {None, "http://127.0.0.1:3000"}:
            raise ValueError("Unsupported local frontend origin")
        self.frontend_origin = frontend_origin
        self.frontend_port = frontend_port
        self.api_paths = None

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        public = self.public_access is not None and self.public_access.accepts(scope)
        headers = Headers(scope=scope)
        server = scope.get("server")
        local = server in {("127.0.0.1", self.local_port), ("127.0.0.1", self.frontend_port)}
        host = f"127.0.0.1:{server[1]}" if local else None
        safe_origin = headers.get("origin") in {None, f"http://{host}", self.frontend_origin}
        if not public and (not local or headers.get("host") != host or not safe_origin):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await PlainTextResponse("Forbidden", status_code=403)(scope, receive, send)
            return
        scope = dict(scope)
        scope["state"] = {**scope.get("state", {}), "website_local": not public}
        if scope["type"] == "http" and scope["path"].startswith("/v1/"):
            if self.api_paths is None:
                self.api_paths = [path_pattern(path) for path in scope["app"].openapi()["paths"]]
            if not any(pattern.fullmatch(scope["path"]) for pattern in self.api_paths):
                await PlainTextResponse("Not Found", 404, headers={"Cache-Control": "no-store"})(
                    scope, receive, send
                )
                return
            if headers.get("authorization", "").lower().startswith("bearer ") and (
                self.automation_policy is None
                or not self.automation_policy(scope["method"], scope["path"])
            ):
                await PlainTextResponse(
                    "Automation operation is not allowed",
                    403,
                    headers={"Cache-Control": "no-store"},
                )(scope, receive, send)
                return

        async def observe(message):
            if (
                message["type"] == "http.response.start"
                and not public
                and scope.get("method") == "GET"
                and scope["path"] == "/v1/auth/me"
            ):
                MutableHeaders(scope=message)["X-Fpl-Invite-Registration"] = "allowed"
            if (
                message["type"] == "http.response.start"
                and 200 <= message["status"] < 300
                and scope.get("method") in {"POST", "PUT", "PATCH", "DELETE"}
                and not scope["path"].startswith("/v1/automation/")
            ):
                principal = scope["state"].get("studio_principal")
                if principal and principal.auth_kind == "management_api_key":
                    revisions = scope["app"].state.automation_changes
                    revisions[principal.user_id] = revisions.get(principal.user_id, 0) + 1
            await send(message)

        if public:
            await self.public_access(self.app, scope, receive, observe)
        else:
            await self.app(scope, receive, observe)


def attach_website(
    app,
    *,
    web_root: Path,
    local_port: int,
    frontend_origin=None,
    frontend_port=None,
    static=None,
    public_access=None,
    automation_policy=None,
):
    if not (web_root / "index.html").is_file():
        raise ValueError("网站资源缺失，请先运行 npm run build:studio")
    app.state.website_enabled = True
    app.state.automation_changes = {}
    app.add_middleware(
        WebsiteTransport,
        local_port=local_port,
        frontend_origin=frontend_origin,
        frontend_port=frontend_port,
        public_access=public_access,
        automation_policy=automation_policy,
    )
    app.mount("/", static or WebsiteStaticFiles(directory=web_root, html=True), name="website")
