"""Transfer a verified Tools download to the Assets owner under its original account."""

import asyncio
from contextlib import aclosing

import httpx

from app.tool_navigation.video_download_contracts import VideoDownloadAssetOut
from app.tool_navigation.video_download_errors import VideoDownloadError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.tools_video import VIDEO_JOB_PATH
from fpl_runtime.tools_video_library import ToolLibraryDescription, library_path


class VideoLibrary:
    def __init__(self, client):
        self.client = client

    async def store(self, *, assertion, job_id, folder_id, path, result):
        description = ToolLibraryDescription(
            result.filename, result.mime_type, result.byte_size, result.content_sha256, folder_id
        )
        target = library_path(job_id, description.fingerprint)
        grant = RequestGrant(
            "tools", "tools.library-output.write", "POST", VIDEO_JOB_PATH, "assets", "POST", target
        )

        async def chunks():
            with path.open("rb") as source:
                while chunk := await asyncio.to_thread(source.read, 1024 * 1024):
                    yield chunk

        try:
            token = await self.client.authorize_request(assertion, grant)
            async with aclosing(chunks()) as content:
                response = await self.client.client.post(
                    "http://assets:8080" + target,
                    headers={
                        HEADER: token,
                        "Content-Length": str(description.byte_size),
                        "Content-Type": "application/octet-stream",
                        "X-Fpl-Output-Descriptor": description.header(),
                    },
                    content=content,
                    timeout=600,
                )
            if response.status_code in {401, 403, 404, 409, 413, 422}:
                raise VideoDownloadError(
                    "下载文件入库未通过归属、容量或摘要校验",
                    code="library_output_rejected",
                    status=response.status_code,
                )
            response.raise_for_status()
            asset = VideoDownloadAssetOut.model_validate(response.json())
            if (
                not asset.id
                or asset.byte_size != result.byte_size
                or asset.mime_type != result.mime_type
            ):
                raise ValueError("download asset receipt mismatch")
            return asset
        except CapabilityDenied as exc:
            raise VideoDownloadError(
                "下载文件入库授权已撤销", code="authorization_revoked", status=403
            ) from exc
        except VideoDownloadError:
            raise
        except (CapabilityUnavailable, httpx.HTTPError, OSError, ValueError) as exc:
            raise VideoDownloadError(
                "下载文件入库结果未确认", code="library_output_unconfirmed", status=503
            ) from exc
