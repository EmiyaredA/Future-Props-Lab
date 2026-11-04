"""Freeze the validated Galgame route and delegate one exact frame to Rendering."""

import asyncio

import httpx
from pydantic import ValidationError

from app.capabilities.asset_store.errors import AssetError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_frames import (
    FRAMES,
    INPUT_HEADER,
    INPUT_PURPOSE,
    INPUTS,
    MAX_FRAME_REQUEST,
    RENDER_PURPOSE,
    GalgameFrame,
)
from fpl_runtime.motion_preview import sha256

from .export_preflight import export_context, frozen_plan


async def exact_frame(request, files, project_id, body):
    story, assets, duration, preview = await export_context(request, files, project_id, body)
    if not preview.ready:
        raise AssetError(
            "精确帧预览未通过导出检查",
            code="video_export_not_ready",
            detail={"preview": preview.model_dump(mode="json", by_alias=True)},
        )
    if body.time_ms > preview.route.estimated_duration_ms:
        raise AssetError("预览时间超出导出范围", code="invalid_time", status=422)
    payload = body.model_dump(mode="json", by_alias=True, exclude={"time_ms", "width"})
    try:
        frame = GalgameFrame(
            **frozen_plan(story, assets, duration, preview, payload),
            time_ms=body.time_ms,
            width=body.width,
        )
    except ValidationError as exc:
        raise AssetError(
            "精确帧输入无效", code="video_export_compilation_failed", status=422
        ) from exc
    return await render_exact_frame(files, project_id, frame)


async def render_exact_frame(files, project, frame):
    raw = frame.model_dump_json().encode()
    if len(raw) > MAX_FRAME_REQUEST:
        raise AssetError("Story 超过精确帧大小限制", code="frame_request_too_large", status=413)
    inputs = f"{INPUTS}/{project}/{frame.scope.digest}"
    target = f"{FRAMES}/{project}/{sha256(raw)}/{frame.scope.digest}"
    capabilities = files.capabilities
    try:
        token, asset_token = await asyncio.gather(
            capabilities.authorize_request(
                files.assertion,
                RequestGrant(
                    "galgame",
                    RENDER_PURPOSE,
                    "POST",
                    files.source_path,
                    "rendering",
                    "POST",
                    target,
                ),
            ),
            capabilities.authorize_request(
                files.assertion,
                RequestGrant(
                    "galgame", INPUT_PURPOSE, "POST", files.source_path, "assets", "POST", inputs
                ),
            ),
        )
        response = await capabilities.client.post(
            "http://rendering:8080" + target,
            content=raw,
            headers={HEADER: token, INPUT_HEADER: asset_token, "Content-Type": "application/json"},
            timeout=httpx.Timeout(300, connect=5),
        )
        if response.status_code in {401, 403, 409, 413, 422, 429, 507}:
            detail = response.json().get("detail")
            info = detail if isinstance(detail, dict) else {}
            raise AssetError(
                info.get("message", "精确帧请求未通过"),
                code=info.get("code", "galgame_frame_rejected"),
                status=response.status_code,
            )
        response.raise_for_status()
        png = response.content
        if (
            response.headers.get("content-type") != "image/png"
            or not png.startswith(b"\x89PNG\r\n\x1a\n")
            or len(png) > MAX_FRAME_REQUEST
        ):
            raise ValueError("unexpected Galgame frame response")
        return png
    except CapabilityDenied as exc:
        raise AssetError(
            "精确帧授权已结束", code="galgame_frame_denied", status=exc.status
        ) from exc
    except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise AssetError("精确帧暂不可用", code="galgame_frame_unavailable", status=503) from exc
