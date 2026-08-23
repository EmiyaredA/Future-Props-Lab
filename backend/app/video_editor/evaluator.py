from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

from app.schemas.video_editor import VideoEditorClip, VideoEditorTimelineDocument


def timeline_duration_us(document: VideoEditorTimelineDocument) -> int:
    return max(
        (
            clip.timeline_start_us + clip.duration_us
            for track in document.tracks
            for clip in track.clips
        ),
        default=0,
    )


def _curve(progress: float, interpolation: str) -> float:
    progress = max(0.0, min(1.0, progress))
    if interpolation == "ease-in":
        return progress * progress
    if interpolation == "ease-out":
        return 1 - (1 - progress) ** 2
    if interpolation == "ease-in-out":
        return progress * progress * (3 - 2 * progress)
    return progress


def property_at(clip: VideoEditorClip, name: str, local_us: int, fallback: float) -> float:
    keys = sorted(
        (item for item in clip.keyframes if item.property == name), key=lambda item: item.time_us
    )
    if not keys or local_us < keys[0].time_us:
        return fallback
    if local_us >= keys[-1].time_us:
        return keys[-1].value
    right_index = next(index for index, item in enumerate(keys) if item.time_us > local_us)
    left, right = keys[right_index - 1], keys[right_index]
    progress = (local_us - left.time_us) / max(1, right.time_us - left.time_us)
    progress = _curve(progress, right.interpolation)
    return left.value + (right.value - left.value) * progress


def clip_opacity(clip: VideoEditorClip, local_us: int) -> float:
    opacity = property_at(clip, "opacity", local_us, clip.transform.opacity)
    if clip.transition_in and clip.transition_in.duration_us:
        progress = min(1, local_us / clip.transition_in.duration_us)
        if clip.transition_in.kind in {"crossfade", "fade-black", "fade-white"}:
            opacity *= progress
    if clip.transition_out and clip.transition_out.duration_us:
        remaining = clip.duration_us - local_us
        progress = min(1, remaining / clip.transition_out.duration_us)
        if clip.transition_out.kind in {"crossfade", "fade-black", "fade-white"}:
            opacity *= progress
    return max(0, min(1, opacity))


def visual_gaps(document: VideoEditorTimelineDocument) -> list[tuple[int, int]]:
    end = timeline_duration_us(document)
    intervals = sorted(
        (
            clip.timeline_start_us,
            clip.timeline_start_us + clip.duration_us,
        )
        for track in document.tracks
        if track.kind == "visual" and not track.hidden
        for clip in track.clips
    )
    gaps: list[tuple[int, int]] = []
    cursor = 0
    for start, stop in intervals:
        if start > cursor:
            gaps.append((cursor, start))
        cursor = max(cursor, stop)
    if cursor < end:
        gaps.append((cursor, end))
    return gaps


@dataclass
class FrameSource:
    image_for_clip: Callable[[VideoEditorClip, int], Image.Image | None]
    font_for_clip: Callable[[VideoEditorClip], Path | None]


class TimelineFrameRenderer:
    def __init__(self, document: VideoEditorTimelineDocument, source: FrameSource) -> None:
        self.document = document
        self.source = source

    def render(self, time_us: int, *, size: tuple[int, int] | None = None) -> Image.Image:
        settings = self.document.settings
        canvas = Image.new(
            "RGBA",
            (settings.width, settings.height),
            ImageColor.getrgb(settings.background_color) + (255,),
        )
        tracks = sorted(
            (
                track
                for track in self.document.tracks
                if track.kind == "visual" and not track.hidden
            ),
            key=lambda track: track.order,
            reverse=True,
        )
        for track in tracks:
            for clip in track.clips:
                local_us = time_us - clip.timeline_start_us
                if not 0 <= local_us < clip.duration_us:
                    continue
                layer = self._layer(clip, local_us)
                if layer is not None:
                    self._composite(canvas, layer, clip, local_us)
        if size and canvas.size != size:
            canvas = canvas.resize(size, Image.Resampling.LANCZOS)
        return canvas.convert("RGB")

    def _layer(self, clip: VideoEditorClip, local_us: int) -> Image.Image | None:
        if clip.kind == "color":
            return Image.new(
                "RGBA",
                (self.document.settings.width, self.document.settings.height),
                ImageColor.getrgb(clip.color or "#000000") + (255,),
            )
        if clip.kind == "text":
            return self._text_layer(clip)
        return self.source.image_for_clip(clip, local_us)

    def _text_layer(self, clip: VideoEditorClip) -> Image.Image:
        font_path = self.source.font_for_clip(clip)
        try:
            font = (
                ImageFont.truetype(str(font_path), clip.font_size)
                if font_path
                else ImageFont.load_default(clip.font_size)
            )
        except (OSError, TypeError):
            font = ImageFont.load_default()
        lines = (clip.text or "").splitlines() or [""]
        boxes = [font.getbbox(line or " ") for line in lines]
        width = max(box[2] - box[0] for box in boxes) + 32
        height = sum(box[3] - box[1] + 12 for box in boxes) + 20
        layer = Image.new("RGBA", (max(1, width), max(1, height)), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        y = 10
        for line, box in zip(lines, boxes, strict=True):
            draw.text((16, y), line, font=font, fill=clip.text_color)
            y += box[3] - box[1] + 12
        return layer

    @staticmethod
    def _composite(
        canvas: Image.Image, layer: Image.Image, clip: VideoEditorClip, local_us: int
    ) -> None:
        transform = clip.transform
        scale_x = property_at(clip, "scaleX", local_us, transform.scale_x)
        scale_y = property_at(clip, "scaleY", local_us, transform.scale_y)
        width = max(1, round(layer.width * scale_x))
        height = max(1, round(layer.height * scale_y))
        if layer.size != (width, height):
            layer = layer.resize((width, height), Image.Resampling.LANCZOS)
        rotation = property_at(clip, "rotation", local_us, transform.rotation)
        if not math.isclose(rotation, 0):
            layer = layer.rotate(-rotation, expand=True, resample=Image.Resampling.BICUBIC)
        opacity = clip_opacity(clip, local_us)
        if opacity < 1:
            alpha = layer.getchannel("A").point(lambda value: round(value * opacity))
            layer.putalpha(alpha)
        x = property_at(clip, "x", local_us, transform.x)
        y = property_at(clip, "y", local_us, transform.y)
        canvas.alpha_composite(layer, (round(x - layer.width / 2), round(y - layer.height / 2)))
