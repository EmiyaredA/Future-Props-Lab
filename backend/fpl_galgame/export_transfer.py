"""Drive the exact Rendering job and stream its sealed output into the Assets intake."""

import asyncio
from contextlib import asynccontextmanager

import httpx

from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.galgame_exports import INPUTS, JOBS, PURPOSE_INPUT, PURPOSE_JOB, ExportReceipt
from fpl_runtime.galgame_frames import INPUT_HEADER
from fpl_runtime.motion_preview import sha256
from fpl_runtime.project_errors import ProjectResourceError


def source_path(project):
    return f"{SOURCE}/{project}/video-exports"


def require_response(response):
    if response.status_code in {401, 403, 404, 409, 413, 422, 429, 507}:
        raise ProjectResourceError(
            "Rendering 未能完成导出请求", "render_export_rejected", response.status_code
        )
    response.raise_for_status()


class RenderExport:
    def __init__(self, capabilities, assertion, project, identity, plan, *, origin=None):
        self.capabilities, self.assertion = capabilities, assertion
        self.project, self.identity, self.plan = project, identity, plan
        self.source_method, self.source = origin or ("POST", source_path(project))
        self.raw = plan.model_dump_json().encode()
        self.target = f"{JOBS}/{project}/{identity}/{sha256(self.raw)}"

    async def token(self, service, purpose, method, path):
        try:
            return await self.capabilities.authorize_request(
                self.assertion,
                RequestGrant(
                    "galgame", purpose, self.source_method, self.source, service, method, path
                ),
            )
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "导出授权已结束", "render_export_denied", exc.status
            ) from exc

    async def request(self, method, suffix="", *, allow_missing=False):
        path = self.target + suffix
        token = await self.token("rendering", PURPOSE_JOB, method, path)
        response = await self.capabilities.client.request(
            method, "http://rendering:8080" + path, headers={HEADER: token}
        )
        if response.status_code == 404 and allow_missing:
            return None
        require_response(response)
        return response

    async def submit(self):
        scope = self.plan.scope.digest
        path = self.target + "/submit/" + scope
        inputs = f"{INPUTS}/{self.project}/{self.identity}/{scope}"
        token, asset_token = await asyncio.gather(
            self.token("rendering", PURPOSE_JOB, "POST", path),
            self.token("assets", PURPOSE_INPUT, "POST", inputs),
        )
        response = await self.capabilities.client.post(
            "http://rendering:8080" + path,
            content=self.raw,
            headers={HEADER: token, INPUT_HEADER: asset_token, "Content-Type": "application/json"},
        )
        require_response(response)
        return ExportReceipt.model_validate_json(response.content)

    async def status(self):
        response = await self.request("GET", allow_missing=True)
        return ExportReceipt.model_validate_json(response.content) if response is not None else None

    async def cancel(self):
        response = await self.request("POST", "/cancel", allow_missing=True)
        return ExportReceipt.model_validate_json(response.content) if response is not None else None

    async def release(self):
        response = await self.request("POST", "/release", allow_missing=True)
        if response is not None and response.json().get("released") is not True:
            raise ValueError("Rendering export release receipt missing")

    @asynccontextmanager
    async def download(self, media):
        path = self.target + "/download"
        token = await self.token("rendering", PURPOSE_JOB, "GET", path)
        async with self.capabilities.client.stream(
            "GET",
            "http://rendering:8080" + path,
            headers={HEADER: token, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            require_response(response)
            if (
                response.headers.get("content-type") != "video/mp4"
                or response.headers.get("Content-Encoding", "identity") != "identity"
                or int(response.headers.get("Content-Length", "-1")) != media.byte_size
            ):
                raise ValueError("Rendering export bytes changed")
            yield Original(response)


class Original:
    def __init__(self, response):
        self.chunks = response.aiter_bytes(chunk_size=1024 * 1024)

    async def read(self, _size):
        return await anext(self.chunks, b"")
