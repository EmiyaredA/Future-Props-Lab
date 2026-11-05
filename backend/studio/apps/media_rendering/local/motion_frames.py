"""RGBA frame evaluator for motion compositions."""

from __future__ import annotations

import io
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

from studio.apps.media_rendering.local.text_layer import FONT_ROOT
from studio.contracts.motion_compositor.document import (
    MotionComposition,
    MotionLayer,
    MotionMask,
    MotionPoint,
)


def _curve(t: float, kind: str) -> float:
    if kind == "hold":
        return 0
    if kind == "ease-in":
        return t * t
    if kind == "ease-out":
        return 1 - (1 - t) ** 2
    if kind == "ease-in-out":
        return t * t * (3 - 2 * t)
    return t


def value_at(layer: MotionLayer, property_name: str, frame: int) -> float:
    frame -= layer.start_frame
    keys = sorted(
        (key for key in layer.keyframes if key.property == property_name),
        key=lambda key: key.frame,
    )
    fallback = layer.transform.model_dump(by_alias=True)[property_name]
    if not keys or frame < keys[0].frame:
        return float(fallback)
    if frame >= keys[-1].frame:
        return keys[-1].value
    right_index = next(index for index, key in enumerate(keys) if key.frame > frame)
    left, right = keys[right_index - 1], keys[right_index]
    t = (frame - left.frame) / max(1, right.frame - left.frame)
    return left.value + (right.value - left.value) * _curve(t, right.interpolation)


def _point_at(a: MotionPoint, b: MotionPoint, ratio: float) -> MotionPoint:
    av, bv = a.model_dump(), b.model_dump()
    return MotionPoint(**{key: av[key] + (bv[key] - av[key]) * ratio for key in av})


def mask_points_at(mask: MotionMask, frame: int) -> list[MotionPoint]:
    keys = sorted(mask.keyframes, key=lambda key: key.frame)
    if not keys or frame < keys[0].frame:
        return mask.points
    if frame >= keys[-1].frame:
        return keys[-1].points
    right_index = next(index for index, key in enumerate(keys) if key.frame > frame)
    left, right = keys[right_index - 1], keys[right_index]
    ratio = (frame - left.frame) / max(1, right.frame - left.frame)
    return [_point_at(a, b, ratio) for a, b in zip(left.points, right.points, strict=True)]


def _bezier_path(points: list[MotionPoint]) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        for step in range(16):
            t = step / 16
            u = 1 - t
            result.append(
                (
                    u**3 * start.x
                    + 3 * u * u * t * (start.x + start.out_x)
                    + 3 * u * t * t * (end.x + end.in_x)
                    + t**3 * end.x,
                    u**3 * start.y
                    + 3 * u * u * t * (start.y + start.out_y)
                    + 3 * u * t * t * (end.y + end.in_y)
                    + t**3 * end.y,
                )
            )
    return result


def _mask_layer(image: Image.Image, mask: MotionMask, frame: int) -> Image.Image:
    stencil = Image.new("L", image.size, 0)
    ImageDraw.Draw(stencil).polygon(_bezier_path(mask_points_at(mask, frame)), fill=255)
    if mask.feather:
        stencil = stencil.filter(ImageFilter.GaussianBlur(mask.feather))
    if mask.inverted:
        stencil = ImageOps.invert(stencil)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), stencil))
    return image


def _shape(layer: MotionLayer) -> Image.Image:
    image = Image.new("RGBA", (layer.width, layer.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if layer.shape == "ellipse":
        draw.ellipse((0, 0, layer.width - 1, layer.height - 1), fill=layer.fill)
    elif layer.shape == "triangle":
        draw.polygon(
            [(layer.width / 2, 0), (layer.width, layer.height), (0, layer.height)],
            fill=layer.fill,
        )
    elif layer.shape == "speedLines":
        for index in range(12):
            y = round(index * layer.height / 12)
            x = (index * 47) % max(1, layer.width // 3)
            draw.line((x, y, layer.width, max(0, y - 28)), fill=layer.fill, width=3 + index % 4)
    else:
        draw.rectangle((0, 0, layer.width - 1, layer.height - 1), fill=layer.fill)
    return image


def _text(layer: MotionLayer) -> Image.Image:
    candidates = sorted(FONT_ROOT.glob("*.ttf")) + sorted(FONT_ROOT.glob("*.otf"))
    font = (
        ImageFont.truetype(str(candidates[0]), layer.font_size)
        if candidates
        else ImageFont.load_default()
    )
    measure = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bounds = measure.multiline_textbbox((0, 0), layer.text or " ", font=font, spacing=10)
    image = Image.new("RGBA", (layer.width, layer.height), (0, 0, 0, 0))
    ImageDraw.Draw(image).multiline_text(
        (
            (layer.width - (bounds[2] - bounds[0])) / 2 - bounds[0],
            (layer.height - (bounds[3] - bounds[1])) / 2 - bounds[1],
        ),
        layer.text,
        font=font,
        fill=layer.fill,
        spacing=10,
    )
    return image


def _video_frame(path: Path, source_time_us: int) -> Image.Image | None:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{source_time_us / 1_000_000:.6f}",
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
        capture_output=True,
        check=False,
    )
    if result.returncode or not result.stdout:
        return None
    with Image.open(io.BytesIO(result.stdout)) as source:
        return source.convert("RGBA")


class MotionFrameRenderer:
    def __init__(self, document: MotionComposition, assets: dict[str, Path]) -> None:
        self.document = document
        self.assets = assets
        self.images: dict[str, Image.Image] = {}

    def _source(self, layer: MotionLayer, frame: int) -> Image.Image | None:
        if layer.kind == "shape":
            return _shape(layer)
        if layer.kind == "text":
            return _text(layer)
        path = self.assets.get(layer.asset_id or "")
        if not path:
            return None
        if layer.kind == "video":
            source_time = layer.source_start_us + round(
                (frame - layer.start_frame) * 1_000_000 / self.document.settings.fps
            )
            frame_image = _video_frame(path, source_time)
            return (
                frame_image.resize((layer.width, layer.height), Image.Resampling.LANCZOS)
                if frame_image
                else None
            )
        if layer.asset_id not in self.images:
            with Image.open(path) as source:
                self.images[layer.asset_id or ""] = source.convert("RGBA")
        return self.images[layer.asset_id or ""].resize(
            (layer.width, layer.height), Image.Resampling.LANCZOS
        )

    def _effects(self, image: Image.Image, layer: MotionLayer) -> Image.Image:
        effect = layer.effects
        if effect.duotone:
            gray = ImageOps.grayscale(image)
            toned = ImageOps.colorize(gray, "#151820", "#ee3648").convert("RGBA")
            toned.putalpha(image.getchannel("A"))
            image = toned
        if effect.halftone:
            dots = Image.new("L", image.size, 0)
            draw = ImageDraw.Draw(dots)
            step = max(5, effect.halftone)
            radius = max(1, step // 4)
            for y in range(step // 2, image.height, step):
                for x in range(step // 2, image.width, step):
                    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
            image.putalpha(ImageChops.multiply(image.getchannel("A"), dots))
        if effect.outline or effect.shadow:
            alpha = image.getchannel("A")
            canvas = Image.new("RGBA", image.size, (0, 0, 0, 0))
            if effect.shadow:
                shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
                shifted = ImageChops.offset(alpha, effect.shadow // 2, effect.shadow // 2)
                shadow.putalpha(
                    shifted.filter(ImageFilter.GaussianBlur(max(1, effect.shadow // 3)))
                )
                canvas.alpha_composite(shadow)
            if effect.outline:
                size = effect.outline * 2 + 1
                expanded = alpha.filter(ImageFilter.MaxFilter(size if size % 2 else size + 1))
                outline = Image.new("RGBA", image.size, layer.stroke)
                outline.putalpha(expanded)
                canvas.alpha_composite(outline)
            canvas.alpha_composite(image)
            image = canvas
        return image

    def render(self, frame: int) -> Image.Image:
        width, height = self.document.settings.width, self.document.settings.height
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        for layer in self.document.layers:
            if not layer.visible or not layer.start_frame <= frame < layer.end_frame:
                continue
            image = self._source(layer, frame)
            if image is None:
                continue
            if layer.mask:
                image = _mask_layer(image, layer.mask, frame - layer.start_frame)
            image = self._effects(image, layer)
            sx = max(0.01, value_at(layer, "scaleX", frame))
            sy = max(0.01, value_at(layer, "scaleY", frame))
            image = image.resize(
                (max(1, round(image.width * sx)), max(1, round(image.height * sy))),
                Image.Resampling.LANCZOS,
            )
            rotation = value_at(layer, "rotation", frame)
            if not math.isclose(rotation, 0):
                image = image.rotate(-rotation, expand=True, resample=Image.Resampling.BICUBIC)
            opacity = max(0, min(1, value_at(layer, "opacity", frame)))
            if opacity < 1:
                alpha_channel = image.getchannel("A")
                image.putalpha(
                    alpha_channel.point(lambda alpha, value=opacity: round(alpha * value))
                )
            x = round(value_at(layer, "x", frame) - image.width / 2)
            y = round(value_at(layer, "y", frame) - image.height / 2)
            canvas.alpha_composite(image, (x, y))
        return canvas
