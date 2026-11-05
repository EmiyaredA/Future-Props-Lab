"""Freeze one owned timeline read before forwarding it for frame rendering."""

import httpx
from fastapi import HTTPException

from app.capabilities.media_rendering.timeline_ranges import frame_asset_ids, timeline_duration_us
from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.timeline_read import VideoTimelineRead
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_preview import FrameFile, FrameScope, sha256
from studio.contracts.video_editor.timeline_document import parse_timeline_document
from studio.contracts.video_editor.video_frames import (
    MAX_FRAME_BYTES,
    PREFIX,
    PURPOSE,
    TextLayerRequest,
    VideoFrameRequest,
    clip_digest,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.revisions import RevisionConflictError

from .timeline_media import TimelineMedia


class FrameRequests:
    def __init__(self, request, session, owner):
        self.request, self.session = request, session
        self.capabilities = request.app.state.capabilities
        self.timelines = VideoTimelineRead(session, owner)
        self.media = TimelineMedia(request, session, owner, self.capabilities)

    async def document(self, project, revision):
        timeline = await self.timelines.row(project)
        if timeline.revision != revision:
            raise RevisionConflictError(
                revision,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        document = parse_timeline_document(timeline.document)
        await self.session.rollback()
        return document

    async def scope(self, project, ids):
        originals = await self.media.originals(project, ids)
        if set(originals) != ids:
            raise VideoEditorNotFoundError("预览素材不存在")
        try:
            return FrameScope(
                files=tuple(
                    FrameFile(id=identity, revision=originals[identity].revision)
                    for identity in sorted(ids)
                )
            ), originals
        except ValueError:
            raise VideoEditorValidationError(
                "预览素材范围超限", code="invalid_frame_scope"
            ) from None

    async def frame(self, project, revision, time_us, width, compare):
        document = await self.document(project, revision)
        if compare and not any(
            clip.id == compare and clip.chroma_key and clip.chroma_key.enabled
            for track in document.tracks
            for clip in track.clips
        ):
            raise VideoEditorValidationError(
                "对比片段不存在或未启用抠像", code="invalid_compare_clip"
            )
        if time_us > timeline_duration_us(document):
            raise VideoEditorValidationError("预览时间超出时间轴", code="invalid_time")
        files, _originals = await self.scope(project, frame_asset_ids(document, time_us))
        body = VideoFrameRequest(
            revision=revision,
            time_us=time_us,
            width=width,
            without_chroma_clip_id=compare,
            document=document.model_dump(mode="json", by_alias=True),
            scope=files,
        )
        return await self.render(project, "frame", body)

    async def text(self, project, clip_id, revision):
        document = await self.document(project, revision)
        clip = next(
            (
                clip
                for track in document.tracks
                for clip in track.clips
                if clip.id == clip_id and clip.kind == "text"
            ),
            None,
        )
        if clip is None:
            raise VideoEditorNotFoundError("文字片段不存在")
        ids = {clip.font_asset_id} if clip.font_asset_id else set()
        files, originals = await self.scope(project, ids)
        if any(item.media_kind != "font" for item in originals.values()):
            raise VideoEditorNotFoundError("字体素材不存在")
        return await self.render(
            project,
            f"text/{clip_digest(clip.id)}",
            TextLayerRequest(
                revision=revision,
                clip=clip.model_dump(mode="json", by_alias=True),
                scope=files,
            ),
        )

    async def render(self, project, view, frozen):
        body = frozen.model_dump_json().encode()
        if len(body) > MAX_FRAME_BYTES:
            raise HTTPException(413, "video_frame_request_too_large")
        target = f"{PREFIX}/{project}/{view}/{sha256(body)}/{frozen.scope.digest}"
        request = self.request
        grant = RequestGrant("video", PURPOSE, "GET", request.url.path, "rendering", "POST", target)
        try:
            token = await self.capabilities.authorize_request(
                request.state.service_assertion, grant
            )
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
                    raise HTTPException(response.status_code, "video_frame_rejected")
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
