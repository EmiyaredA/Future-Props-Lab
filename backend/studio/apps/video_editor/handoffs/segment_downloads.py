"""Stream the exact task archive from Assets under current owner authorization."""

import httpx
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorUnavailableError
from studio.apps.video_editor.handoffs.segment_requests import KIND, MISSING
from studio.apps.video_editor.task_reads import VideoTaskReads
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.video_editor.video_segments import BUNDLES, PURPOSE
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


async def segment_download(request, session, owner, project, task):
    result = await VideoTaskReads(session, owner).get(project, task, kind=KIND, missing=MISSING)
    if result.status != "completed":
        raise AssetError("分段导出尚未完成", code="export_not_ready", status=409)
    segments = result.result_detail.get("segments", [])
    if not segments or any(item.get("status") != "completed" for item in segments):
        raise VideoEditorNotFoundError("分段导出文件不存在")
    await session.rollback()

    target = f"{BUNDLES}/{project}/{task}"
    grant = RequestGrant("video", PURPOSE, "GET", request.url.path, "assets", "GET", target)
    capabilities = request.app.state.capabilities
    client = capabilities.client
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        headers = {HEADER: token, "Accept-Encoding": "identity"}
        for name in ("range", "if-range"):
            if name in request.headers:
                headers[name] = request.headers[name]
        response = await client.send(
            client.build_request(
                "GET",
                "http://assets:8080" + target,
                headers=headers,
                timeout=httpx.Timeout(600, connect=5),
            ),
            stream=True,
        )
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError):
        raise VideoEditorUnavailableError("分段导出归档暂不可用") from None
    if (
        response.status_code not in {200, 206, 400, 416}
        or response.headers.get("content-encoding", "identity") != "identity"
    ):
        await response.aclose()
        if response.status_code == 404:
            raise VideoEditorNotFoundError("部分分段导出文件不存在")
        raise VideoEditorUnavailableError("分段导出归档暂不可用")

    async def chunks():
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()

    forwarded = (
        "accept-ranges",
        "content-length",
        "content-range",
        "content-type",
        "content-disposition",
        "etag",
        "last-modified",
    )
    return StreamingResponse(
        chunks(),
        status_code=response.status_code,
        headers={
            **{key: response.headers[key] for key in forwarded if key in response.headers},
            "Cache-Control": "no-store",
        },
        background=BackgroundTask(response.aclose),
    )
