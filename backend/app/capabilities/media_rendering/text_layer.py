"""One font/layout implementation for text preview, exact frames and final video."""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

from studio.contracts.video_editor.timeline_document import VideoEditorClip

TEXT_RENDER_VERSION = 2
FONT_ROOT = Path(__file__).resolve().parent / "assets"


@lru_cache(maxsize=64)
def load_text_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    # Missing/broken font assets must fail explicitly, never silently render tofu.
    return ImageFont.truetype(path, size)


def wrap_text(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Preserve explicit blank lines and spaces; wrap by measured glyph advance."""
    lines: list[str] = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = ""
        for char in paragraph.expandtabs(4):
            candidate = line + char
            if line and font.getlength(candidate) > width:
                lines.append(line)
                line = char
            else:
                line = candidate
        lines.append(line)
    return lines


def render_text_layer(clip: VideoEditorClip, font_path: Path | None = None) -> Image.Image:
    font = load_text_font(str(font_path or FONT_ROOT / "NotoSansSC-Regular.ttf"), clip.font_size)
    if clip.text_style is None:
        return _legacy_text_layer(clip, font)
    style = clip.text_style
    stroke = style.stroke_width
    padding_x, padding_y = 16 + stroke, 10 + stroke
    max_width = clip.text_max_width or 1600
    lines = wrap_text(clip.text or "", font, max(1, max_width - padding_x * 2))
    ascent, descent = font.getmetrics()
    line_height = max(math.ceil(clip.font_size * 1.25), ascent + descent)
    boxes = [font.getbbox(line or " ") for line in lines]
    content_width = max(math.ceil(font.getlength(line)) for line in lines)
    width = max(max_width, content_width + padding_x * 2)
    height = line_height * len(lines) + padding_y * 2
    if height > 16384 or width * height > 32_000_000:
        raise ValueError("文字排版过长，请拆分成多个文字片段")
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    if style.background_opacity:
        draw.rounded_rectangle(
            (0, 0, width - 1, height - 1),
            radius=8,
            fill=(
                *ImageColor.getrgb(style.background_color),
                round(style.background_opacity * 255),
            ),
        )
    for index, (line, box) in enumerate(zip(lines, boxes, strict=True)):
        line_width = font.getlength(line)
        x = padding_x
        if style.align == "center":
            x = (width - line_width) / 2
        elif style.align == "right":
            x = width - padding_x - line_width
        draw.text(
            (x - min(0, box[0]), padding_y + index * line_height),
            line,
            font=font,
            fill=clip.text_color,
            stroke_width=stroke,
            stroke_fill=style.stroke_color,
        )
    return layer


def _legacy_text_layer(clip: VideoEditorClip, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Keep existing snapshots' padding, line spacing and left alignment."""
    import textwrap

    lines = (clip.text or "").splitlines() or [""]
    if clip.text_max_width:
        approximate = max(1, round(clip.text_max_width / max(8, clip.font_size)))
        lines = [part for line in lines for part in (textwrap.wrap(line, approximate) or [""])]
    boxes = [font.getbbox(line or " ") for line in lines]
    width = max(box[2] - box[0] for box in boxes) + 32
    height = sum(box[3] - box[1] + 12 for box in boxes) + 20
    if height > 16384 or width * height > 32_000_000:
        raise ValueError("文字排版过长，请拆分成多个文字片段")
    layer = Image.new("RGBA", (max(1, width), max(1, height)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    y = 10
    for line, box in zip(lines, boxes, strict=True):
        draw.text((16 - box[0], y - box[1]), line, font=font, fill=clip.text_color)
        y += box[3] - box[1] + 12
    return layer


def text_layer_png(clip, font_path):
    import io

    with render_text_layer(clip, font_path) as layer:
        output = io.BytesIO()
        layer.save(output, format="PNG")
        return output.getvalue()
