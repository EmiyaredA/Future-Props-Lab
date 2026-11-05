"""Send a sealed Rendering archive to the exact Video handoff receipt."""

import asyncio

import httpx

from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_handoff import (
    PURPOSE_VIDEO,
    VIDEO_ARCHIVE_HEADER,
    VIDEO_ARCHIVE_SOURCE,
    VIDEO_TARGET,
    VideoHandoffReceipt,
    handoff_path,
)
from fpl_runtime.project_errors import ProjectResourceError


class VideoHandoff:
    def __init__(self, capabilities, assertion, project, identity, digest):
        self.capabilities, self.assertion = capabilities, assertion
        self.source = handoff_path(project)
        self.target = f"{VIDEO_TARGET}/{project}/{identity}/{digest}"

    async def token(self, method, path):
        try:
            return await self.capabilities.authorize_request(
                self.assertion,
                RequestGrant("galgame", PURPOSE_VIDEO, "POST", self.source, "video", method, path),
            )
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "剪辑交接授权已结束", "video_handoff_denied", exc.status
            ) from exc

    async def receipt_token(self):
        return await self.token("GET", self.target)

    async def status(self, token):
        response = await self.capabilities.client.get(
            "http://video:8080" + self.target, headers={HEADER: token}
        )
        if response.status_code == 404:
            return None
        return self.receipt(response)

    async def publish(self, renderer, media):
        token, archive = await asyncio.gather(
            self.token("POST", self.target), self.token("POST", VIDEO_ARCHIVE_SOURCE)
        )
        async with renderer.download(media) as original:
            response = await self.capabilities.client.post(
                "http://video:8080" + self.target,
                content=original.chunks,
                headers={
                    HEADER: token,
                    VIDEO_ARCHIVE_HEADER: archive,
                    "Content-Type": "application/zip",
                    "Content-Length": str(media.byte_size),
                },
                timeout=httpx.Timeout(360, connect=5),
            )
        return self.receipt(response)

    @staticmethod
    def receipt(response):
        if response.status_code in {401, 403, 404, 409, 413, 422}:
            raise ProjectResourceError(
                "Video 未能接收剪辑交接", "video_handoff_rejected", response.status_code
            )
        response.raise_for_status()
        return VideoHandoffReceipt.model_validate_json(response.content)
