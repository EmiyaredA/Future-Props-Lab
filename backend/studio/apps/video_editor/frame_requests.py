"""Freeze one owned timeline read before forwarding it for frame rendering."""

from typing import Protocol

from studio.apps.media_rendering.local.timeline_ranges import frame_asset_ids, timeline_duration_us
from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.schemas import VideoEditorTimelineOut
from studio.contracts.motion_compositor.motion_preview import FrameFile, FrameScope
from studio.contracts.video_editor.video_assets import VideoAsset
from studio.contracts.video_editor.video_frames import (
    TextLayerRequest,
    VideoFrameRequest,
    clip_digest,
)
from studio.runtime.revisions import RevisionConflictError


class FrameTimelines(Protocol):
    async def get(self, project: str) -> VideoEditorTimelineOut: ...


class FrameAssets(Protocol):
    async def originals(self, project: str, ids: set[str]) -> dict[str, VideoAsset]: ...


class FrameRenderer(Protocol):
    async def render(
        self, project: str, view: str, frozen: VideoFrameRequest | TextLayerRequest
    ) -> bytes: ...


class FrameRequests:
    """Domain checks operate on detached facts and injected capabilities."""

    def __init__(self, timelines: FrameTimelines, media: FrameAssets, renderer: FrameRenderer):
        self.timelines, self.media, self.renderer = timelines, media, renderer

    async def document(self, project, revision):
        timeline = await self.timelines.get(project)
        if timeline.revision != revision:
            raise RevisionConflictError(
                revision,
                timeline.revision,
                {
                    "revision": timeline.revision,
                    "document": timeline.document.model_dump(mode="json", by_alias=True),
                },
            )
        return timeline.document

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
        return await self.renderer.render(project, "frame", body)

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
        return await self.renderer.render(
            project,
            f"text/{clip_digest(clip.id)}",
            TextLayerRequest(
                revision=revision,
                clip=clip.model_dump(mode="json", by_alias=True),
                scope=files,
            ),
        )
