from __future__ import annotations

import io
import subprocess
from functools import lru_cache
from pathlib import Path

from PIL import Image

from studio.apps.media_rendering.local.evaluator import FrameSource, TimelineFrameRenderer
from studio.apps.media_rendering.local.inputs import RenderPlan
from studio.apps.media_rendering.local.speed import source_time_us
from studio.apps.media_rendering.local.video_sampling import source_frame_time
from studio.contracts.video_editor.timeline_document import VideoEditorClip


def _extract_video_frame(path: Path, source_us: int) -> Image.Image:
    # Floor only the selected frame's seek timestamp, never the requested time
    # by a nominal FPS. A rounded-up PTS would discard this frame again.
    frame_us = int(source_frame_time(path, source_us) * 1_000_000)
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{frame_us / 1_000_000:.6f}",
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
        timeout=30,
    )
    return Image.open(io.BytesIO(result.stdout)).convert("RGBA")


@lru_cache(maxsize=64)
def _load_image(path: str) -> Image.Image:
    with Image.open(path) as source:
        return source.convert("RGBA")


def render_plan_frame(
    plan: RenderPlan,
    *,
    time_us: int,
    width: int = 960,
    without_chroma_clip_id: str | None = None,
) -> bytes:
    def image_for_clip(clip: VideoEditorClip, local_us: int) -> Image.Image | None:
        path = plan.asset_paths.get(clip.asset_id or "")
        if path is None:
            return None
        if clip.kind == "video":
            return _extract_video_frame(path, source_time_us(clip, local_us))
        if clip.kind == "image":
            return _load_image(str(path)).copy()
        return None

    frame = TimelineFrameRenderer(
        plan.document,
        FrameSource(
            image_for_clip=image_for_clip,
            font_for_clip=lambda clip: plan.asset_paths.get(clip.font_asset_id or ""),
        ),
        without_chroma_clip_id=without_chroma_clip_id,
    ).render(time_us)
    capture = plan.capture_frame
    frame = frame.crop(
        (capture.x, capture.y, capture.x + capture.width, capture.y + capture.height)
    ).resize((width, width * 9 // 16), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    frame.save(output, format="PNG", optimize=False)
    return output.getvalue()
