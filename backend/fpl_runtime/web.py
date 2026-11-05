"""Verified, versioned program resources and per-application write compatibility."""

import hashlib
import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .catalog import service_by_id


@dataclass(frozen=True)
class WebRelease:
    root: Path
    service: str
    build_id: str
    api_sha256: str
    entry: str
    files: dict

    @property
    def prefix(self):
        return f"/_apps/{self.service}/{self.build_id}"


def load_release(root, service):
    root = Path(root)
    if root.is_symlink():
        raise ValueError("应用程序目录不能是符号链接")
    service_by_id(service)
    try:
        manifest = json.loads((root / "build.json").read_text())
        if (
            manifest["version"] != 1
            or manifest["service"] != service
            or not re.fullmatch("[a-f0-9]{20}", manifest["build_id"])
            or not re.fullmatch("[a-f0-9]{64}", manifest["api_sha256"])
        ):
            raise ValueError()
        files = {}
        for item in manifest["files"]:
            path = Path(item["path"])
            if (
                path.is_absolute()
                or not path.parts
                or any(part.startswith(".") for part in path.parts)
                or item["path"] in files
                or not re.fullmatch("[a-f0-9]{64}", item["sha256"])
                or type(item["bytes"]) is not int
                or item["bytes"] < 0
            ):
                raise ValueError()
            if (
                len(path.parts) > 1
                and path.parts[0]
                not in {
                    "assets",
                    "brand",
                    "providers",
                    "fonts",
                    "voice-vad",
                    "presentation-templates",
                    *({"docs"} if service == "portal" else set()),
                }
            ) or (
                len(path.parts) == 1
                and item["path"]
                not in {manifest["entry"], manifest["entry"] + ".gz", manifest["entry"] + ".br"}
            ):
                raise ValueError()
            if "\\" in item["path"] or path.suffix in {
                ".py",
                ".ts",
                ".tsx",
                ".toml",
                ".db",
                ".pem",
                ".key",
            }:
                raise ValueError()
            target = root / path
            if (
                target.is_symlink()
                or not target.is_file()
                or any(parent.is_symlink() for parent in target.parents if parent != root.parent)
                or target.stat().st_size != item["bytes"]
                or hashlib.sha256(target.read_bytes()).hexdigest() != item["sha256"]
            ):
                raise ValueError()
            files[item["path"]] = dict(item)
        if not files or len(files) > 20000 or manifest["entry"] not in files:
            raise ValueError()
        actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
        if actual != set(files) | {"build.json"}:
            raise ValueError()
        if any(path.is_symlink() for path in root.rglob("*")):
            raise ValueError()
    except (ValueError, OSError, KeyError, TypeError) as exc:
        raise ValueError("应用程序资源缺失、损坏或包含未登记文件") from exc
    return WebRelease(
        root.resolve(),
        service,
        manifest["build_id"],
        manifest["api_sha256"],
        manifest["entry"],
        files,
    )


class ProgramCompatibility:
    def __init__(self, app, *, release):
        self.app, self.release = app, release

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/v1/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        if (
            scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}
            and headers.get("x-application-id") == self.release.service
            and headers.get("x-application-build")
            and headers.get("x-application-build") != self.release.build_id
        ):
            await JSONResponse(
                {
                    "code": "application_update_required",
                    "service": self.release.service,
                    "build_id": self.release.build_id,
                },
                409,
                headers={
                    "Cache-Control": "no-store",
                    "X-Application-Id": self.release.service,
                    "X-Application-Build": self.release.build_id,
                },
            )(scope, receive, send)
            return

        async def versioned(message):
            if message["type"] == "http.response.start":
                outgoing = MutableHeaders(scope=message)
                outgoing["X-Application-Id"] = self.release.service
                outgoing["X-Application-Build"] = self.release.build_id
            await send(message)

        await self.app(scope, receive, versioned)


def attach_web(app, release, *, pages, resource_aliases=None):
    async def entry(_request):
        return FileResponse(
            release.root / release.entry,
            media_type="text/html",
            headers={"Cache-Control": "no-cache", "X-Application-Build": release.build_id},
        )

    async def resource(request):
        name = request.path_params["path"]
        if name == "build.json":
            return FileResponse(release.root / name, headers={"Cache-Control": "no-cache"})
        if name not in release.files or name.endswith((".gz", ".br")):
            return JSONResponse({"code": "not_found"}, 404)
        chosen, encoding = name, ""
        if "range" not in request.headers:
            qualities = {}
            for token in request.headers.get("accept-encoding", "").split(","):
                parts = [part.strip() for part in token.split(";")]
                try:
                    quality = float(next((p[2:] for p in parts[1:] if p.startswith("q=")), "1"))
                except ValueError:
                    quality = 0
                qualities[parts[0]] = quality if 0 <= quality <= 1 else 0
            candidates = sorted(
                ("br", "gzip"), key=lambda item: qualities.get(item, 0), reverse=True
            )
            for candidate in candidates:
                sidecar = name + (".br" if candidate == "br" else ".gz")
                if qualities.get(candidate, 0) > 0 and sidecar in release.files:
                    chosen, encoding = sidecar, candidate
                    break
        response = FileResponse(
            release.root / chosen,
            media_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Vary": "Accept-Encoding",
                "X-Content-Type-Options": "nosniff",
                "ETag": '"' + release.files[chosen]["sha256"] + '"',
            },
        )
        if encoding:
            response.headers["Content-Encoding"] = encoding
        supplied = request.headers.get("if-none-match", "")
        if any(
            value.strip().removeprefix("W/") in {"*", response.headers["etag"]}
            for value in supplied.split(",")
        ):
            return Response(status_code=304, headers=dict(response.headers))
        return response

    app.router.routes.append(
        Route(release.prefix + "/{path:path}", resource, methods=["GET", "HEAD"])
    )
    for page in pages:
        app.router.routes.append(Route(page, entry, methods=["GET", "HEAD"]))

    def alias(prefix):
        async def redirect(request):
            name = prefix + request.path_params["path"]
            if name not in release.files or name.endswith((".gz", ".br")):
                return JSONResponse({"code": "not_found"}, 404)
            return RedirectResponse(
                release.prefix + "/" + quote(name, safe="/"),
                status_code=307,
                headers={"Cache-Control": "no-store"},
            )

        return redirect

    for path, prefix in (resource_aliases or {}).items():
        app.router.routes.append(Route(path, alias(prefix), methods=["GET", "HEAD"]))
    app.state.web_build = release.build_id
    app.add_middleware(ProgramCompatibility, release=release)
