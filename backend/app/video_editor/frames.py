from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.files.storage import AssetStorage
from app.media_rendering.contracts import RenderCaptureFrame, RenderPlan
from app.media_rendering.evaluator import timeline_duration_us
from app.media_rendering.frame_renderer import render_plan_frame
from app.models import VideoEditorTimeline, VisualAsset
from app.schemas.video_editor import VideoEditorTimelineDocument
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.projects import VideoEditorProjects


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
        if time_us < 0 or time_us > timeline_duration_us(document):
            raise VideoEditorValidationError("预览时间超出时间轴", code="invalid_time")
        cache = (
            self.storage.project_root("video-editor", project_id, workspace_id=self.workspace_id)
            / "derived"
            / f"frame-r{revision}-t{time_us}-w{width}.png"
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
        )
        temporary = cache.with_suffix(f".{os.getpid()}.tmp")
        try:
            temporary.write_bytes(payload)
            os.replace(temporary, cache)
        finally:
            temporary.unlink(missing_ok=True)
        return payload
