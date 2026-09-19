from __future__ import annotations

import io
import os
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import VideoEditorTimeline
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.schemas import VideoEditorTimelineDocument
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.contracts import RenderCaptureFrame, RenderPlan
from app.capabilities.media_rendering.evaluator import timeline_duration_us
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.capabilities.media_rendering.text_layer import TEXT_RENDER_VERSION, render_text_layer
from app.runtime.config import get_settings
from app.runtime.revisions import RevisionConflictError


class VideoEditorFrames:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.storage = AssetStorage(get_settings())

    async def render(
        self,
        project_id: str,
        *,
        revision: int,
        time_us: int,
        width: int = 960,
        without_chroma_clip_id: str | None = None,
    ) -> bytes:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        if timeline is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        if timeline.revision != revision:
            raise RevisionConflictError(
                revision,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        document = VideoEditorTimelineDocument.model_validate(timeline.document)
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
            self.storage.project_root("video-editor", project_id, workspace_id=self.workspace_id)
            / "derived"
            / f"frame-v{TEXT_RENDER_VERSION}-chroma1-r{revision}-t{time_us}-w{width}"
            f"-raw{comparison_key}.png"
        )
        if cache.is_file():
            return cache.read_bytes()
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

        payload = render_plan_frame(
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
        temporary = cache.with_suffix(f".{os.getpid()}.tmp")
        try:
            temporary.write_bytes(payload)
            os.replace(temporary, cache)
        finally:
            temporary.unlink(missing_ok=True)
        return payload

    async def text_layer(self, project_id: str, *, clip_id: str, revision: int) -> bytes:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
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
        document = VideoEditorTimelineDocument.model_validate(timeline.document)
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
        try:
            layer = render_text_layer(clip, font_path)
        except (ValueError, OSError) as exc:
            raise VideoEditorValidationError(
                "文字图层无法渲染，请检查字体与文字长度", code="invalid_text_layer"
            ) from exc
        output = io.BytesIO()
        layer.save(output, format="PNG")
        return output.getvalue()
