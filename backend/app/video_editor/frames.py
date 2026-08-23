from __future__ import annotations

import io
import subprocess
from functools import lru_cache
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.files.storage import AssetStorage
from app.models import VideoEditorTimeline, VisualAsset
from app.schemas.video_editor import VideoEditorClip, VideoEditorTimelineDocument
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.evaluator import FrameSource, TimelineFrameRenderer, timeline_duration_us
from app.video_editor.projects import VideoEditorProjects


def _extract_video_frame(path: Path, source_us: int) -> Image.Image:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{source_us / 1_000_000:.6f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(io.BytesIO(result.stdout)).convert("RGBA")


@lru_cache(maxsize=64)
def _load_image(path: str) -> Image.Image:
    with Image.open(path) as source:
        return source.convert("RGBA")


class VideoEditorFrames:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = AssetStorage(get_settings())

    async def render(
        self,
        project_id: str,
        *,
        revision: int,
        time_us: int,
        width: int = 960,
    ) -> bytes:
        await VideoEditorProjects(self.session).row(project_id)
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

        def image_for_clip(clip: VideoEditorClip, local_us: int) -> Image.Image | None:
            path = paths.get(clip.asset_id or "")
            if path is None:
                return None
            if clip.kind == "video":
                return _extract_video_frame(path, clip.source_in_us + local_us)
            if clip.kind == "image":
                return _load_image(str(path)).copy()
            return None

        frame = TimelineFrameRenderer(
            document,
            FrameSource(
                image_for_clip=image_for_clip,
                font_for_clip=lambda clip: paths.get(clip.font_asset_id or ""),
            ),
        ).render(time_us, size=(width, width * 9 // 16))
        output = io.BytesIO()
        frame.save(output, format="PNG", optimize=False)
        return output.getvalue()
