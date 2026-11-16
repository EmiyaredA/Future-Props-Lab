"""Bounded HTTP renderer for an authorized frozen frame."""

import httpx

from studio.apps.video_editor.errors import (
    FrameRejected,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_preview import sha256
from studio.contracts.video_editor.video_frames import MAX_FRAME_BYTES, PREFIX, PURPOSE
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


class HttpFrameRenderer:
    def __init__(self, capabilities, *, assertion, source_path):
        self.capabilities = capabilities
        self.assertion, self.source_path = assertion, source_path

    async def render(self, project, view, frozen):
        body = frozen.model_dump_json().encode()
        if len(body) > MAX_FRAME_BYTES:
            raise FrameRejected(413, "video_frame_request_too_large")
        target = f"{PREFIX}/{project}/{view}/{sha256(body)}/{frozen.scope.digest}"
        grant = RequestGrant("video", PURPOSE, "GET", self.source_path, "rendering", "POST", target)
        try:
            token = await self.capabilities.authorize_request(self.assertion, grant)
            async with self.capabilities.client.stream(
                "POST",
                "http://rendering:8080" + target,
                content=body,
                headers={HEADER: token, "Accept-Encoding": "identity"},
                timeout=httpx.Timeout(120, connect=5),
            ) as response:
                if response.status_code == 422 and view.startswith("text/"):
                    raise VideoEditorValidationError(
                        "文字图层无法渲染，请检查字体与文字长度", code="invalid_text_layer"
                    )
                if response.status_code in {401, 403, 409, 413, 422, 429}:
                    raise FrameRejected(response.status_code, "video_frame_rejected")
                response.raise_for_status()
                if (
                    response.headers.get("Content-Type") != "image/png"
                    or response.headers.get("Content-Encoding", "identity") != "identity"
                ):
                    raise ValueError("invalid video PNG response")
                payload = bytearray()
                async for chunk in response.aiter_raw():
                    if len(payload) + len(chunk) > MAX_FRAME_BYTES:
                        raise ValueError("oversized video PNG response")
                    payload.extend(chunk)
                if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("invalid video PNG response")
                return bytes(payload)
        except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
            raise VideoEditorUnavailableError("剪辑预览暂不可用") from None
