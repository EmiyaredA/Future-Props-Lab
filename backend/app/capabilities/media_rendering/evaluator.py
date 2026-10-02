"""Deterministic timeline evaluation shared by media workshop features."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter

from app.capabilities.media_rendering.chroma_key import apply_chroma_key
from app.capabilities.media_rendering.text_layer import render_text_layer
from app.capabilities.media_rendering.timeline_document import (
    VideoEditorClip,
    VideoEditorTimelineDocument,
    VideoEditorTimelineTransition,
)


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


def _transition_progress(value_us: int, duration_us: int, interpolation: str) -> float:
    return _curve(value_us / max(1, duration_us), interpolation)


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
    """Keyframe/base opacity only; clip-edge fades are applied via clip_edge_visual."""
    opacity = property_at(clip, "opacity", local_us, clip.transform.opacity)
    return max(0, min(1, opacity))


@dataclass(frozen=True)
class ClipEdgeVisual:
    visibility: float
    opacity: float
    kind: str
    progress: float
    direction: str
    overlay_color: tuple[int, int, int] | None
    overlay_alpha: int


def _edge_overlay(kind: str, visibility: float) -> tuple[tuple[int, int, int] | None, int]:
    if kind == "fade-black":
        return ((0, 0, 0), round((1 - visibility) * 255))
    if kind == "fade-white":
        return ((255, 255, 255), round((1 - visibility) * 255))
    if kind == "flash" and visibility < 0.55:
        return ((255, 255, 255), round((1 - visibility / 0.55) * 235))
    return (None, 0)


def _edge_opacity(kind: str, visibility: float) -> float:
    return 1 if kind in {"fade-black", "fade-white", "wipe", "eyelid"} else visibility


def clip_edge_visual(clip: VideoEditorClip, local_us: int) -> ClipEdgeVisual | None:
    """Resolve the active clip-local edge transition at local_us, if any."""
    if (
        clip.transition_in
        and clip.transition_in.duration_us
        and clip.transition_in.kind != "audio-crossfade"
        and 0 <= local_us < clip.transition_in.duration_us
    ):
        edge = clip.transition_in
        progress = _transition_progress(local_us, edge.duration_us, edge.easing)
        overlay_color, overlay_alpha = _edge_overlay(edge.kind, progress)
        return ClipEdgeVisual(
            visibility=progress,
            opacity=_edge_opacity(edge.kind, progress),
            kind=edge.kind,
            progress=progress,
            direction=edge.direction,
            overlay_color=overlay_color,
            overlay_alpha=overlay_alpha,
        )
    if (
        clip.transition_out
        and clip.transition_out.duration_us
        and clip.transition_out.kind != "audio-crossfade"
    ):
        remaining = clip.duration_us - local_us
        if 0 <= remaining < clip.transition_out.duration_us:
            edge = clip.transition_out
            through = _transition_progress(
                edge.duration_us - remaining, edge.duration_us, edge.easing
            )
            visibility = 1 - through
            overlay_color, overlay_alpha = _edge_overlay(edge.kind, visibility)
            return ClipEdgeVisual(
                visibility=visibility,
                opacity=_edge_opacity(edge.kind, visibility),
                kind=edge.kind,
                progress=visibility,
                direction=edge.direction,
                overlay_color=overlay_color,
                overlay_alpha=overlay_alpha,
            )
    return None


def visual_gaps(document: VideoEditorTimelineDocument) -> list[tuple[int, int]]:
    end = timeline_duration_us(document)
    intervals = sorted(
        (
            clip.timeline_start_us,
            clip.timeline_start_us + clip.duration_us,
        )
        for track in document.tracks
        if track.kind in {"visual", "mixed"} and not track.hidden
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


def _media_local_us(
    clip: VideoEditorClip, time_us: int, transitions: list[VideoEditorTimelineTransition]
) -> int:
    incoming = next((item for item in transitions if item.to_clip_id == clip.id), None)
    offset = max(1, incoming.duration_us // 2) if incoming and incoming.kind != "flash" else 0
    # Keep the incoming handle offset through subsequent outgoing transitions;
    # hold the last frame when the media range is spent.
    return max(0, min(clip.duration_us - 1, time_us - clip.timeline_start_us + offset))


class TimelineFrameRenderer:
    def __init__(
        self,
        document: VideoEditorTimelineDocument,
        source: FrameSource,
        *,
        without_chroma_clip_id: str | None = None,
    ) -> None:
        self.document = document
        self.source = source
        self.without_chroma_clip_id = without_chroma_clip_id
        self._portrait_ground_ratio_by_asset: dict[str, float] = {}
        self._frame_overlay: tuple[tuple[int, int, int], int] | None = None
        self._eyelid_progress: float | None = None

    def render(self, time_us: int, *, size: tuple[int, int] | None = None) -> Image.Image:
        settings = self.document.settings
        self._frame_overlay = None
        self._eyelid_progress = None
        canvas = Image.new(
            "RGBA",
            (settings.width, settings.height),
            ImageColor.getrgb(settings.background_color) + (255,),
        )
        tracks = sorted(
            (
                track
                for track in self.document.tracks
                if track.kind in {"visual", "mixed"} and not track.hidden
            ),
            key=lambda track: track.order,
            reverse=True,
        )
        for track in tracks:
            clips = sorted(track.clips, key=lambda item: item.timeline_start_us)
            clips_by_id = {clip.id: clip for clip in clips}
            transitions = [
                item
                for item in self.document.transitions
                if item.placement == "between"
                and item.from_clip_id
                and item.to_clip_id
                and item.from_clip_id in clips_by_id
                and item.to_clip_id in clips_by_id
            ]
            active_transitions = [
                item
                for item in transitions
                if clips_by_id[item.to_clip_id].timeline_start_us - max(1, item.duration_us // 2)
                <= time_us
                < clips_by_id[item.to_clip_id].timeline_start_us + max(1, item.duration_us // 2)
            ]
            handled_between: set[str] = set()
            seam_drawn_clips: set[str] = set()

            for clip in clips:
                if clip.id in seam_drawn_clips:
                    continue
                local_us = time_us - clip.timeline_start_us
                between = next(
                    (
                        item
                        for item in active_transitions
                        if (item.from_clip_id == clip.id or item.to_clip_id == clip.id)
                    ),
                    None,
                )
                if between and between.id not in handled_between:
                    left = next((item for item in clips if item.id == between.from_clip_id), None)
                    right = next((item for item in clips if item.id == between.to_clip_id), None)
                    if left and right:
                        seam_us = right.timeline_start_us
                        half_us = max(1, between.duration_us // 2)
                        start_us = seam_us - half_us
                        end_us = seam_us + half_us
                        if start_us <= time_us < end_us:
                            progress = _transition_progress(
                                time_us - start_us,
                                between.duration_us,
                                between.easing,
                            )
                            handled_between.add(between.id)
                            seam_drawn_clips.add(left.id)
                            seam_drawn_clips.add(right.id)
                            if between.kind == "flash":
                                # 前半在片段尾升白，后半从片段头退白。
                                if time_us < seam_us:
                                    left_local_us = _media_local_us(left, time_us, transitions)
                                    left_layer = self._layer(left, left_local_us)
                                    if left_layer is not None:
                                        self._composite_with_edge(
                                            canvas,
                                            left_layer,
                                            left,
                                            left_local_us,
                                            edge_local_us=time_us - left.timeline_start_us,
                                        )
                                    first = max(
                                        0.0,
                                        min(
                                            1.0,
                                            (time_us - start_us) / max(1, half_us),
                                        ),
                                    )
                                    self._queue_frame_overlay((255, 255, 255), round(first * 230))
                                else:
                                    right_local_us = _media_local_us(right, time_us, transitions)
                                    right_layer = self._layer(right, right_local_us)
                                    if right_layer is not None:
                                        self._composite_with_edge(
                                            canvas, right_layer, right, right_local_us
                                        )
                                    second = max(
                                        0.0,
                                        min(
                                            1.0,
                                            (time_us - seam_us) / max(1, half_us),
                                        ),
                                    )
                                    self._queue_frame_overlay(
                                        (255, 255, 255), round((1 - second) * 230)
                                    )
                                continue

                            if between.kind in {"fade-black", "fade-white"}:
                                color = (
                                    (0, 0, 0) if between.kind == "fade-black" else (255, 255, 255)
                                )
                                active = left if progress < 0.5 else right
                                active_local_us = _media_local_us(active, time_us, transitions)
                                active_layer = self._layer(active, active_local_us)
                                if active_layer is not None:
                                    self._composite_with_edge(
                                        canvas,
                                        active_layer,
                                        active,
                                        active_local_us,
                                        edge_local_us=max(0, time_us - active.timeline_start_us),
                                    )
                                overlay_progress = (
                                    progress * 2 if progress < 0.5 else (1 - progress) * 2
                                )
                                self._queue_frame_overlay(color, round(overlay_progress * 255))
                                continue

                            if between.kind == "eyelid":
                                opening = (
                                    1 - progress * 2 if time_us < seam_us else (progress - 0.5) * 2
                                )
                                self._eyelid_progress = max(0.0, min(1.0, opening))
                                active = left if time_us < seam_us else right
                                active_local_us = _media_local_us(active, time_us, transitions)
                                active_layer = self._layer(active, active_local_us)
                                if active_layer is not None:
                                    self._composite_with_edge(
                                        canvas,
                                        active_layer,
                                        active,
                                        active_local_us,
                                        edge_local_us=max(
                                            0,
                                            min(
                                                active.duration_us - 1,
                                                time_us - active.timeline_start_us,
                                            ),
                                        ),
                                    )
                                continue

                            # Crossfade / wipe / zoom / blur across the centered window.
                            left_local_us = _media_local_us(left, time_us, transitions)
                            right_local_us = _media_local_us(right, time_us, transitions)
                            left_layer = self._layer(left, left_local_us)
                            right_layer = self._layer(right, right_local_us)
                            left_edge_local = max(
                                0,
                                min(left.duration_us - 1, time_us - left.timeline_start_us),
                            )
                            right_edge_local = max(0, time_us - right.timeline_start_us)
                            if left_layer is not None:
                                left_opacity = 1 if between.kind == "wipe" else 1 - progress
                                self._composite_with_edge(
                                    canvas,
                                    left_layer,
                                    left,
                                    left_local_us,
                                    opacity_multiplier=left_opacity,
                                    transition_kind=(
                                        between.kind if between.kind in {"zoom", "blur"} else None
                                    ),
                                    transition_progress=(
                                        1 - progress if between.kind in {"zoom", "blur"} else None
                                    ),
                                    edge_local_us=left_edge_local,
                                )
                            if right_layer is not None:
                                right_opacity = 1 if between.kind == "wipe" else progress
                                self._composite_with_edge(
                                    canvas,
                                    right_layer,
                                    right,
                                    right_local_us,
                                    opacity_multiplier=right_opacity,
                                    transition_kind=(
                                        between.kind
                                        if between.kind in {"wipe", "zoom", "blur"}
                                        else None
                                    ),
                                    transition_progress=progress,
                                    direction=between.direction,
                                    edge_local_us=right_edge_local,
                                )
                            continue
                        if time_us >= end_us:
                            handled_between.add(between.id)
                if clip.id in seam_drawn_clips:
                    continue
                if not 0 <= local_us < clip.duration_us:
                    continue
                draw_local_us = _media_local_us(clip, time_us, transitions)
                layer = self._layer(clip, draw_local_us)
                if layer is None:
                    continue
                self._composite_with_edge(
                    canvas, layer, clip, draw_local_us, edge_local_us=local_us
                )
        if self._eyelid_progress is not None:
            self._draw_eyelid_overlay(canvas, self._eyelid_progress)
        if self._frame_overlay is not None:
            color, alpha = self._frame_overlay
            canvas.alpha_composite(Image.new("RGBA", canvas.size, (*color, alpha)))
        if size and canvas.size != size:
            canvas = canvas.resize(size, Image.Resampling.LANCZOS)
        return canvas.convert("RGB")

    @staticmethod
    def _draw_eyelid_overlay(canvas: Image.Image, opening: float) -> None:
        """Draw curved upper and lower eyelids around a centered eye-shaped opening."""
        opening = max(0.0, min(1.0, opening))
        if opening >= 1:
            return
        width, height = canvas.size
        edge_y = height * (1 - opening) / 2
        curve_y = edge_y - height * opening * 0.3
        steps = max(24, width // 16)
        top_curve = [
            (
                round(width * index / steps),
                round(
                    height
                    * (edge_y / height + 2 * (curve_y / height - edge_y / height) * t * (1 - t))
                ),
            )
            for index in range(steps + 1)
            for t in [index / steps]
        ]
        bottom_curve = [(x, height - y) for x, y in top_curve]
        draw = ImageDraw.Draw(canvas)
        draw.polygon([(0, 0), (width, 0), *reversed(top_curve)], fill=(0, 0, 0, 255))
        draw.polygon([(0, height), (width, height), *bottom_curve], fill=(0, 0, 0, 255))

    def _queue_frame_overlay(self, color: tuple[int, int, int], alpha: int) -> None:
        if alpha <= 0:
            return
        if self._frame_overlay is None or alpha > self._frame_overlay[1]:
            self._frame_overlay = (color, alpha)

    def _layer(self, clip: VideoEditorClip, local_us: int) -> Image.Image | None:
        if clip.kind == "color":
            return Image.new(
                "RGBA",
                (self.document.settings.width, self.document.settings.height),
                ImageColor.getrgb(clip.color or "#000000") + (255,),
            )
        if clip.kind == "text":
            return self._text_layer(clip)
        layer = self.source.image_for_clip(clip, local_us)
        if layer is not None and clip.chroma_key and clip.id != self.without_chroma_clip_id:
            return apply_chroma_key(layer, clip.chroma_key)
        return layer

    def _text_layer(self, clip: VideoEditorClip) -> Image.Image:
        return render_text_layer(clip, self.source.font_for_clip(clip))

    @staticmethod
    def _visible_alpha_bottom(layer: Image.Image) -> float:
        if "A" not in layer.getbands():
            return float(layer.height)
        alpha = layer.getchannel("A")
        minimum_visible_pixels = max(1, math.ceil(layer.width * 0.002))
        pixels = alpha.load()
        for y in range(layer.height - 1, -1, -1):
            if sum(pixels[x, y] >= 8 for x in range(layer.width)) >= minimum_visible_pixels:
                return float(y + 1)
        return float(layer.height)

    @staticmethod
    def _rotate_about_anchor(
        layer: Image.Image,
        rotation: float,
        anchor: str,
        *,
        grounded_bottom: float | None = None,
    ) -> tuple[Image.Image, tuple[float, float]]:
        if anchor == "topLeft":
            pivot = (0.0, 0.0)
        elif anchor == "bottomCenter":
            pivot = (
                layer.width / 2,
                grounded_bottom if grounded_bottom is not None else float(layer.height),
            )
        else:
            pivot = (layer.width / 2, layer.height / 2)
        if math.isclose(rotation, 0):
            return layer, pivot
        radius = math.ceil(math.hypot(layer.width, layer.height)) + 2
        side = radius * 2
        center = side / 2
        padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        padded.alpha_composite(
            layer,
            (round(center - pivot[0]), round(center - pivot[1])),
        )
        rotated = padded.rotate(-rotation, resample=Image.Resampling.BICUBIC)
        bounds = rotated.getbbox()
        if bounds is None:
            return rotated, (center, center)
        cropped = rotated.crop(bounds)
        return cropped, (center - bounds[0], center - bounds[1])

    def _composite_with_edge(
        self,
        canvas: Image.Image,
        layer: Image.Image,
        clip: VideoEditorClip,
        local_us: int,
        *,
        opacity_multiplier: float = 1,
        transition_kind: str | None = None,
        transition_progress: float | None = None,
        direction: str = "left",
        edge_local_us: int | None = None,
    ) -> None:
        """Composite a layer, multiplying any active clip-local edge transition."""
        edge = clip_edge_visual(clip, local_us if edge_local_us is None else edge_local_us)
        if edge is None:
            self._composite(
                canvas,
                layer,
                clip,
                local_us,
                opacity_multiplier=opacity_multiplier,
                transition_kind=transition_kind,
                transition_progress=transition_progress,
                direction=direction,
            )
            return
        if edge.kind == "eyelid":
            self._eyelid_progress = edge.progress
        # Prefer seam wipe/zoom kind when both apply; still multiply visibility / flash.
        self._composite(
            canvas,
            layer,
            clip,
            local_us,
            opacity_multiplier=opacity_multiplier * edge.opacity,
            transition_kind=transition_kind or edge.kind,
            transition_progress=(
                transition_progress if transition_progress is not None else edge.progress
            ),
            direction=direction if transition_kind else edge.direction,
        )
        if edge.overlay_color and edge.overlay_alpha:
            self._queue_frame_overlay(edge.overlay_color, edge.overlay_alpha)

    def _composite(
        self,
        canvas: Image.Image,
        layer: Image.Image,
        clip: VideoEditorClip,
        local_us: int,
        *,
        opacity_multiplier: float = 1,
        transition_kind: str | None = None,
        transition_progress: float | None = None,
        direction: str = "left",
    ) -> None:
        transform = clip.transform
        canvas_width, canvas_height = canvas.size
        if transition_kind == "blur" and transition_progress is not None:
            radius = max(0, round((1 - transition_progress) * 10))
            if radius:
                layer = layer.filter(ImageFilter.GaussianBlur(radius=radius))
        if clip.fit_mode in {"cover", "contain"}:
            ratio = (
                max(canvas_width / layer.width, canvas_height / layer.height)
                if clip.fit_mode == "cover"
                else min(canvas_width / layer.width, canvas_height / layer.height)
            )
            layer = layer.resize(
                (max(1, round(layer.width * ratio)), max(1, round(layer.height * ratio))),
                Image.Resampling.LANCZOS,
            )
        elif clip.fit_mode == "height" and clip.height_percent:
            ratio = canvas_height * clip.height_percent / 100 / layer.height
            layer = layer.resize(
                (max(1, round(layer.width * ratio)), max(1, round(layer.height * ratio))),
                Image.Resampling.LANCZOS,
            )
        ground_ratio: float | None = None
        if clip.fit_mode == "height" and transform.anchor == "bottomCenter":
            ground_key = f"{clip.asset_id or clip.id}:{layer.width}x{layer.height}"
            ground_ratio = self._portrait_ground_ratio_by_asset.get(ground_key)
            if ground_ratio is None:
                ground_ratio = self._visible_alpha_bottom(layer) / max(1, layer.height)
                self._portrait_ground_ratio_by_asset[ground_key] = ground_ratio
        if clip.flip_x:
            layer = layer.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        scale_x = property_at(clip, "scaleX", local_us, transform.scale_x)
        scale_y = property_at(clip, "scaleY", local_us, transform.scale_y)
        if transition_kind == "zoom" and transition_progress is not None:
            zoom = 1 + 0.22 * (1 - transition_progress)
            scale_x *= zoom
            scale_y *= zoom
        width = max(1, round(layer.width * scale_x))
        height = max(1, round(layer.height * scale_y))
        if layer.size != (width, height):
            layer = layer.resize((width, height), Image.Resampling.LANCZOS)
        rotation = property_at(clip, "rotation", local_us, transform.rotation)
        layer, pivot = TimelineFrameRenderer._rotate_about_anchor(
            layer,
            rotation,
            transform.anchor,
            grounded_bottom=(layer.height * ground_ratio if ground_ratio is not None else None),
        )
        if (
            transition_kind in {"wipe", "wipe-left", "wipe-right"}
            and transition_progress is not None
        ):
            reveal = max(0.0, min(1.0, transition_progress))
            mask = Image.new("L", layer.size, 0)
            if direction in {"left", "right"}:
                width = round(layer.width * reveal)
                box = (
                    (layer.width - width, 0, layer.width, layer.height)
                    if direction == "left"
                    else (0, 0, width, layer.height)
                )
            else:
                height = round(layer.height * reveal)
                box = (
                    (0, layer.height - height, layer.width, layer.height)
                    if direction == "up"
                    else (0, 0, layer.width, height)
                )
            ImageDraw.Draw(mask).rectangle(box, fill=255)
            layer.putalpha(
                Image.composite(layer.getchannel("A"), Image.new("L", layer.size, 0), mask)
            )
        opacity = clip_opacity(clip, local_us) * max(0, min(1, opacity_multiplier))
        if opacity < 1:
            alpha = layer.getchannel("A").point(lambda value: round(value * opacity))
            layer.putalpha(alpha)
        brightness = property_at(clip, "brightness", local_us, transform.brightness)
        if not math.isclose(brightness, 1):
            rgb = layer.convert("RGB").point(
                lambda value: max(0, min(255, round(value * brightness)))
            )
            rgb.putalpha(layer.getchannel("A"))
            layer = rgb
        x = property_at(clip, "x", local_us, transform.x)
        y = property_at(clip, "y", local_us, transform.y)
        left, top = x - pivot[0], y - pivot[1]
        canvas.alpha_composite(layer, (round(left), round(top)))
