"""Admit only verified local browser requests and authenticated native workers."""

import asyncio
import base64
import binascii
import secrets
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from app.tool_navigation.video_download_contracts import (
    VideoDownloadDepsOut,
    VideoDownloadJobCreate,
    VideoDownloadJobOut,
)
from app.tool_navigation.video_download_errors import VideoDownloadError
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut
from studio.contracts.asset_library.reveal import (
    APPLICATION_OPERATIONS,
    TOOLS_PREFIX,
    reveal_target,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.tools.tools_native import OPEN_PATH, VIDEO_DEPS_PATH
from studio.contracts.tools.tools_video import (
    DOWNLOAD_VIDEO,
    OUTPUT_DESCRIPTOR_HEADER,
    VIDEO_JOB_PATH,
    VideoDownloadResult,
)
from studio.runtime.http.dependencies import StudioAuth

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
    if host.identity is None:
        raise HTTPException(
            503, {"code": "folder_open_unavailable", "message": "本机文件管理器连接不可用"}
        )
    await host.open_library(principal.user_id, request.state.service_assertion)
    return ProjectFolderOpenOut()


@public.post(TOOLS_PREFIX + "/{application_id}/{project_id}", include_in_schema=False)
async def reveal_project_folder(request: Request, application_id: str, project_id: str):
    path = request.url.path
    if (
        not reveal_target("POST", path, "tools")
        or "cookie" in request.headers
        or "origin" in request.headers
    ):
        raise HTTPException(403, "private_project_reveal_required")
    assertion = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            assertion,
            service="tools",
            method="POST",
            path=path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "project_reveal_authorization_required") from None
    if (
        not actor.local
        or actor.purpose != "studio"
        or actor.auth_kind != "session"
        or "content.write"
        not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
    ):
        raise HTTPException(403, "local_access_required")
    await request.app.state.tools_host.open_folder(
        actor.user_id, assertion, APPLICATION_OPERATIONS[application_id], {"project_id": project_id}
    )
    return ProjectFolderOpenOut()


@public.get(VIDEO_DEPS_PATH, response_model=VideoDownloadDepsOut, tags=["tool-navigation"])
async def get_video_download_deps(request: Request, principal: StudioAuth):
    host = request.app.state.tools_host
    return await host.video_dependencies(
        principal.user_id, request.state.service_assertion, local=request.state.service_actor.local
    )


def _video_error(exc):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@public.post(VIDEO_JOB_PATH, response_model=VideoDownloadJobOut, tags=["tool-navigation"])
async def post_video_download_job(
    body: VideoDownloadJobCreate, request: Request, principal: StudioAuth
):
    try:
        return await request.app.state.tools_videos.create(
            principal.user_id,
            request.state.service_assertion,
            body,
            local=request.state.service_actor.local and principal.auth_kind == "session",
        )
    except VideoDownloadError as exc:
        raise _video_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_request", "message": str(exc)}) from exc


@public.get(
    VIDEO_JOB_PATH + "/{job_id}", response_model=VideoDownloadJobOut, tags=["tool-navigation"]
)
async def get_video_download_job(job_id: str, request: Request, principal: StudioAuth):
    try:
        return await request.app.state.tools_videos.get(principal.user_id, job_id)
    except VideoDownloadError as exc:
        raise _video_error(exc) from exc


@public.get(
    VIDEO_JOB_PATH + "/{job_id}/file",
    response_class=FileResponse,
    tags=["tool-navigation"],
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def download_video_download_file(job_id: str, request: Request, principal: StudioAuth):
    try:
        path, filename = await request.app.state.tools_videos.file(principal.user_id, job_id)
    except VideoDownloadError as exc:
        raise _video_error(exc) from exc
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


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


@native.post("/heartbeat")
async def heartbeat(request: Request, body: Lease):
    host, worker = request.app.state.tools_host, request.state.tools_worker
    await host.authorize(worker, body.lease)
    if not await host.queue.heartbeat(worker_id=worker, lease=body.lease):
        raise HTTPException(410, "tools_lease_ended")
    host.worker_contact()
    return {"active": True}


@native.post("/download-outputs/{job_id}/{lease_id}")
async def download_output(request: Request, job_id: UUID, lease_id: UUID):
    row = await request.app.state.tools_host.download_upload(
        request.state.tools_worker, job_id, lease_id
    )
    encoded = request.headers.get(OUTPUT_DESCRIPTOR_HEADER, "")
    try:
        if not 1 <= len(encoded) <= 4096:
            raise ValueError("descriptor size")
        result = VideoDownloadResult.model_validate_json(base64.b64decode(encoded, validate=True))
        size = int(request.headers.get("content-length", "-1"))
    except (ValueError, TypeError, binascii.Error) as exc:
        raise HTTPException(422, "tools_video_descriptor_invalid") from exc
    if (
        size != result.byte_size
        or request.headers.get("content-encoding", "identity") != "identity"
    ):
        raise HTTPException(422, "tools_video_descriptor_mismatch")
    if size > 8 * 1024 * 1024 * 1024:
        raise HTTPException(413, {"code": "output_too_large", "message": "下载文件超过交付容量"})

    async def authorize_output():
        await request.app.state.tools_host.download_upload(
            request.state.tools_worker, job_id, lease_id
        )

    try:
        await request.app.state.tools_videos.accept_file(
            row, result, request.stream(), authorize=authorize_output
        )
    except VideoDownloadError as exc:
        raise _video_error(exc) from exc
    return {"stored": True}


@native.post("/receipt")
async def receipt(request: Request, body: Receipt):
    outcome = body.outcome
    if body.lease.operation == DOWNLOAD_VIDEO:
        try:
            outcome = await request.app.state.tools_videos.confirmed(body.lease, outcome)
        except VideoDownloadError as exc:
            raise _video_error(exc) from exc
    await request.app.state.tools_host.finish(request.state.tools_worker, body.lease, outcome)
    if body.lease.operation == DOWNLOAD_VIDEO and outcome.status == "completed":
        await request.app.state.tools_videos.discard_library_only_file(body.lease)
    return {"acknowledged": True}
