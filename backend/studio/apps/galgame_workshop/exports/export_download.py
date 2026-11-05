"""Relay a single Galgame video artifact while preserving range semantics."""

from contextlib import aclosing

import httpx
from fastapi.responses import StreamingResponse

from studio.apps.galgame_workshop.storage.models import GalgameVideoExportTask
from studio.apps.galgame_workshop.storage.task_records import TaskRecords
from studio.contracts.galgame_workshop.galgame_assets import EXPORT_DOWNLOAD_PURPOSE, PREFIX
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError

FILE_HEADERS = (
    "content-type",
    "content-disposition",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
)


async def download_export(request, session, owner, project_id, export_id):
    try:
        task = await TaskRecords(session, owner).get(GalgameVideoExportTask, project_id, export_id)
    except ProjectResourceError as exc:
        raise ProjectResourceError("导出视频尚不可下载") from exc
    asset_id = task.output_asset_id
    if asset_id is None:
        raise ProjectResourceError("导出视频尚不可下载")
    await session.rollback()
    target = f"{PREFIX}/{project_id}/exports/{export_id}/files/{asset_id}"
    grant = RequestGrant(
        "galgame", EXPORT_DOWNLOAD_PURPOSE, "GET", request.url.path, "assets", "GET", target
    )
    peer = request.app.state.capabilities
    try:
        token = await peer.authorize_request(request.state.service_assertion, grant)
        headers = {
            name: request.headers[name] for name in ("range", "if-range") if name in request.headers
        }
        upstream = peer.client.build_request(
            "GET",
            "http://assets:8080" + target,
            headers={**headers, HEADER: token, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(60, connect=5),
        )
        response = await peer.client.send(upstream, stream=True)
    except CapabilityDenied as exc:
        raise ProjectResourceError(
            "导出视频访问已撤销", "export_access_denied", exc.status
        ) from exc
    except (httpx.HTTPError, CapabilityUnavailable) as exc:
        raise ProjectResourceError("导出视频暂不可读", "export_download_unavailable", 503) from exc
    if response.status_code not in {200, 206, 400, 416}:
        await response.aclose()
        if response.status_code == 404:
            raise ProjectResourceError("导出视频文件不存在")
        if response.status_code in {401, 403}:
            raise ProjectResourceError(
                "导出视频访问已撤销", "export_access_denied", response.status_code
            )
        raise ProjectResourceError("导出视频暂不可读", "export_download_unavailable", 503)

    async def body():
        async with aclosing(response.aiter_raw()) as stream:
            try:
                async for block in stream:
                    yield block
            finally:
                await response.aclose()

    return StreamingResponse(
        body(),
        status_code=response.status_code,
        headers={
            **{name: response.headers[name] for name in FILE_HEADERS if name in response.headers},
            "cache-control": "private, no-store",
        },
    )
