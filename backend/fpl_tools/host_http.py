"""Admit only verified local browser requests and authenticated native workers."""

import asyncio
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from app.capabilities.asset_store.schemas.project_snapshots import ProjectFolderOpenOut
from app.tool_navigation.video_download_contracts import VideoDownloadDepsOut
from fpl_runtime.http_dependencies import StudioAuth
from fpl_runtime.native_protocol import NativeLease, NativeOutcome
from fpl_runtime.tools_native import OPEN_PATH, VIDEO_DEPS_PATH

from .host import missing_dependencies

public = APIRouter()
native = APIRouter(prefix="/_native/v1", include_in_schema=False)


class NativeIngress:
    def __init__(self, app, *, options):
        self.app, self.options = app, options

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        worker = None
        if (
            self.options is not None
            and "origin" not in headers
            and secrets.compare_digest(
                headers.get("x-fpl-native-ingress", "").encode(), self.options.ingress.encode()
            )
            and headers.get("authorization", "").startswith("Bearer ")
        ):
            credential = headers["authorization"][7:]
            worker = next(
                (
                    key
                    for key, value in self.options.workers.items()
                    if secrets.compare_digest(credential.encode(), value.encode())
                ),
                None,
            )
        if worker is None:
            await JSONResponse(
                {"code": "native_worker_required"}, 403, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)
            return
        state = {**scope.get("state", {}), "tools_worker": worker}
        await self.app({**scope, "state": state}, receive, send)


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: int = Field(default=1, ge=0, le=4)


class Lease(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(Lease):
    outcome: NativeOutcome


@public.post(OPEN_PATH, response_model=ProjectFolderOpenOut, tags=["file-management"])
async def reveal_library_folder(request: Request, principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(
            403,
            {"code": "browser_session_required", "message": "打开文件夹必须使用浏览器 Session"},
        )
    if not request.state.service_actor.local:
        raise HTTPException(
            403, {"code": "local_access_required", "message": "请从本机网站入口打开文件夹"}
        )
    host = request.app.state.tools_host
    if host is None:
        raise HTTPException(
            503, {"code": "folder_open_unavailable", "message": "本机文件管理器连接不可用"}
        )
    await host.open_library(principal.user_id, request.state.service_assertion)
    return ProjectFolderOpenOut()


@public.get(VIDEO_DEPS_PATH, response_model=VideoDownloadDepsOut, tags=["tool-navigation"])
async def get_video_download_deps(request: Request, principal: StudioAuth):
    host = request.app.state.tools_host
    if host is None:
        return missing_dependencies()
    return await host.video_dependencies(
        principal.user_id, request.state.service_assertion, local=request.state.service_actor.local
    )


@native.post("/claim")
async def claim(request: Request, body: Claim):
    for attempt in range(body.wait_seconds * 4 + 1):
        lease = await request.app.state.tools_host.claim(request.state.tools_worker)
        if lease is not None:
            return {"lease": lease.model_dump(mode="json")}
        if attempt < body.wait_seconds * 4:
            await asyncio.sleep(0.25)
    return {"lease": None}


@native.post("/authorize")
async def authorize(request: Request, body: Lease):
    await request.app.state.tools_host.authorize(request.state.tools_worker, body.lease)
    return {"active": True}


@native.post("/receipt")
async def receipt(request: Request, body: Receipt):
    await request.app.state.tools_host.finish(request.state.tools_worker, body.lease, body.outcome)
    return {"acknowledged": True}
