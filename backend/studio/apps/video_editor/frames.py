from __future__ import annotations

import asyncio
import os
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.media_rendering.local.evaluator import (
    FRAME_COMPOSITOR_VERSION,
    timeline_duration_us,
)
from studio.apps.media_rendering.local.frame_renderer import render_plan_frame
from studio.apps.media_rendering.local.inputs import RenderCaptureFrame, RenderPlan
from studio.apps.media_rendering.local.text_layer import TEXT_RENDER_VERSION, text_layer_png
from studio.apps.media_rendering.local.video_sampling import VIDEO_SAMPLING_VERSION
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import VideoEditorClip, parse_timeline_document
from studio.apps.video_editor.storage.models import VideoEditorTimeline
from studio.config.settings import Settings
from studio.runtime.revisions import RevisionConflictError


def _cached_frame(cache: Path) -> bytes | None:
    return cache.read_bytes() if cache.is_file() else None


def _render_frame(
    cache: Path,
    plan: RenderPlan,
    *,
    time_us: int,
    width: int,
    without_chroma_clip_id: str | None,
) -> bytes:
    cached = _cached_frame(cache)
    if cached is not None:
        return cached
    payload = render_plan_frame(
        plan, time_us=time_us, width=width, without_chroma_clip_id=without_chroma_clip_id
    )
    # Parallel requests for the same frame must not share a temporary filename.
    temporary = cache.with_suffix(f".{uuid4().hex}.tmp")
    try:
        temporary.write_bytes(payload)
        os.replace(temporary, cache)
    except FileNotFoundError:
        # A project may be deleted while its read-only decode is finishing.
        # Return the prepared response without recreating deleted cache folders.
        if cache.parent.is_dir():
            raise
    finally:
        temporary.unlink(missing_ok=True)
    return payload


def _text_layer_png(clip: VideoEditorClip, font_path: Path | None) -> bytes:
    try:
        return text_layer_png(clip, font_path)
    except (ValueError, OSError) as exc:
        raise VideoEditorValidationError(
            "文字图层无法渲染，请检查字体与文字长度", code="invalid_text_layer"
        ) from exc


class VideoEditorFrames:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, settings: Settings) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(settings)

    async def render(
        self,
        project_id: str,
        *,
        revision: int,
        time_us: int,
        width: int = 960,
        without_chroma_clip_id: str | None = None,
    ) -> bytes:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        if timeline is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        if timeline.revision != revision:
            raise RevisionConflictError(
                revision,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        document = parse_timeline_document(timeline.document)
        if without_chroma_clip_id and not any(
            clip.id == without_chroma_clip_id and clip.chroma_key and clip.chroma_key.enabled
            for track in document.tracks
            for clip in track.clips
        ):
            raise VideoEditorValidationError(
                "对比片段不存在或未启用抠像", code="invalid_compare_clip"
            )
        if time_us < 0 or time_us > timeline_duration_us(document):
            raise VideoEditorValidationError("预览时间超出时间轴", code="invalid_time")
        comparison_key = (
            sha256(without_chroma_clip_id.encode()).hexdigest()[:16]
            if without_chroma_clip_id
            else "none"
        )
        cache = (
            self.storage.project_root("video-editor", project_id, owner_user_id=self.owner_user_id)
            / "derived"
            / f"frame-v{TEXT_RENDER_VERSION}-composite{FRAME_COMPOSITOR_VERSION}"
            f"-chroma2-sample{VIDEO_SAMPLING_VERSION}"
            f"-r{revision}-t{time_us}-w{width}"
            f"-raw{comparison_key}.png"
        )
        # Cache I/O and decoding must not hold a request's database connection.
        # All values needed below are detached snapshots or validated paths.
        await self.session.rollback()
        cached = await asyncio.to_thread(_cached_frame, cache)
        if cached is not None:
            return cached
        asset_ids = {
            value
            for track in document.tracks
            for clip in track.clips
            for value in (clip.asset_id, clip.font_asset_id)
            if value
        }
        assets = (
            list(
                (
                    await self.session.execute(
                        select(VisualAsset).where(
                            VisualAsset.id.in_(asset_ids),
                            VisualAsset.video_editor_project_id == project_id,
                        )
                    )
                ).scalars()
            )
            if asset_ids
            else []
        )
        paths = {asset.id: self.storage.path_for(asset) for asset in assets}
        await self.session.rollback()

        # Only validated value objects and paths cross into the worker. The
        # request's AsyncSession remains on the event loop that owns it.
        return await asyncio.to_thread(
            _render_frame,
            cache,
            RenderPlan(
                document=document,
                asset_paths=paths,
                capture_frame=RenderCaptureFrame(
                    width=document.settings.width,
                    height=document.settings.height,
                ),
            ),
            time_us=time_us,
            width=width,
            without_chroma_clip_id=without_chroma_clip_id,
        )

    async def text_layer(self, project_id: str, *, clip_id: str, revision: int) -> bytes:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        if timeline is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        if timeline.revision != revision:
            raise RevisionConflictError(
                revision,
                timeline.revision,
                {
                    "revision": timeline.revision,
                    "document": timeline.document,
                },
            )
        document = parse_timeline_document(timeline.document)
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
        font_path = None
        if clip.font_asset_id:
            asset = await self.session.scalar(
                select(VisualAsset).where(
                    VisualAsset.id == clip.font_asset_id,
                    VisualAsset.video_editor_project_id == project_id,
                    VisualAsset.media_kind == "font",
                )
            )
            if asset is None:
                raise VideoEditorNotFoundError("字体素材不存在")
            font_path = self.storage.path_for(asset)
        await self.session.rollback()
        return await asyncio.to_thread(_text_layer_png, clip, font_path)
