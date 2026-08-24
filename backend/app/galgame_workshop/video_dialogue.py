from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageColor, ImageDraw, ImageFont

ASSET_ROOT = Path(__file__).resolve().parent / "assets"
FONT_REGULAR = ASSET_ROOT / "NotoSansSC-Regular.ttf"
FONT_MEDIUM = ASSET_ROOT / "NotoSansSC-Medium.ttf"

BASE_STYLE: dict[str, Any] = {
    "preset": "dark",
    "assetId": None,
    "backgroundColor": "#080E18",
    "textColor": "#FFFFFF",
    "nameColor": "#FFFFFF",
    "backgroundOpacity": 0.82,
    "borderRadius": 12,
    "fontScale": 1,
    "layout": {
        "mode": "boxed",
        "widthPercent": 100,
        "heightPercent": 22,
        "bottomOffsetPercent": 0,
        "contentInsetXPercent": 0,
        "contentInsetTopPercent": 0,
        "contentInsetBottomPercent": 0,
    },
    "background": {
        "mode": "solid",
        "gradientTopOpacity": 0.2,
        "gradientBottomOpacity": 0.94,
        "topRule": "none",
        "topRuleColor": "#FFFFFF",
        "topRuleOpacity": 0.22,
    },
    "body": {"fontSizePx": None, "lineHeight": 1.35, "align": "left", "maxWidthPercent": 100},
    "speakerName": {"placement": "topLeft", "fontSizePx": None, "decoration": "none"},
    "advanceIndicator": {
        "visible": True,
        "position": "bottomRight",
        "style": "descriptive",
        "showInExport": True,
    },
}


def dialogue_renderer_issue() -> str | None:
    missing = [path.name for path in (FONT_REGULAR, FONT_MEDIUM) if not path.is_file()]
    if missing:
        return f"Galgame 导出字体缺失：{', '.join(missing)}"
    try:
        _font(FONT_REGULAR, 16)
        _font(FONT_MEDIUM, 16)
    except (OSError, RuntimeError) as exc:
        return str(exc)
    return None


def _merged(base: dict[str, Any], patch: dict[str, Any] | None) -> dict[str, Any]:
    result = dict(base)
    for key, value in (patch or {}).items():
        result[key] = (
            _merged(result.get(key, {}), value)
            if isinstance(value, dict) and isinstance(result.get(key), dict)
            else value
        )
    return result


def _preset(name: str) -> dict[str, Any]:
    if name == "light":
        return _merged(
            BASE_STYLE,
            {
                "preset": "light",
                "backgroundColor": "#F7F3EA",
                "textColor": "#172033",
                "nameColor": "#B94A48",
                "backgroundOpacity": 0.92,
            },
        )
    if name == "accent":
        return _merged(
            BASE_STYLE,
            {
                "preset": "accent",
                "backgroundColor": "#2F1720",
                "textColor": "#FFF8F6",
                "nameColor": "#FF8B84",
                "backgroundOpacity": 0.88,
            },
        )
    if name == "classicGradient":
        return _merged(
            BASE_STYLE,
            {
                "preset": "classicGradient",
                "backgroundColor": "#05070B",
                "textColor": "#F7F7F5",
                "nameColor": "#F3F1EB",
                "backgroundOpacity": 0.94,
                "borderRadius": 0,
                "layout": {
                    "mode": "bottomOverlay",
                    "widthPercent": 100,
                    "heightPercent": 30,
                    "bottomOffsetPercent": 0,
                    "contentInsetXPercent": 11,
                    "contentInsetTopPercent": 12,
                    "contentInsetBottomPercent": 6,
                },
                "background": {
                    "mode": "verticalGradient",
                    "gradientTopOpacity": 0.18,
                    "gradientBottomOpacity": 0.94,
                    "topRule": "double",
                    "topRuleColor": "#E6E4DD",
                    "topRuleOpacity": 0.24,
                },
                "body": {
                    "fontSizePx": 30,
                    "lineHeight": 1.55,
                    "align": "left",
                    "maxWidthPercent": 78,
                },
                "speakerName": {
                    "placement": "bottomCenter",
                    "fontSizePx": 22,
                    "decoration": "sideLines",
                },
                "advanceIndicator": {
                    "visible": True,
                    "position": "bottomLeft",
                    "style": "compact",
                    "showInExport": True,
                },
            },
        )
    return dict(BASE_STYLE)


def resolve_dialogue_style(
    configured: dict[str, Any] | None, runtime_preset: str | None = None
) -> dict[str, Any]:
    configured = configured or {}
    configured_preset = str(configured.get("preset") or "dark")
    selected = runtime_preset or configured_preset
    base = _preset("dark" if selected == "custom" else selected)
    return _merged(
        base, configured if runtime_preset is None or selected == configured_preset else None
    )


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.is_file():
        raise RuntimeError(f"Galgame 导出字体缺失：{path.name}")
    return ImageFont.truetype(str(path), size)


def _wrap(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int
) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        line = ""
        for character in paragraph:
            candidate = line + character
            if line and draw.textlength(candidate, font=font) > width:
                lines.append(line)
                line = character
            else:
                line = candidate
        lines.append(line)
    return lines or [""]


def _background(
    layer: Image.Image, style: dict[str, Any], bounds: tuple[int, int, int, int]
) -> None:
    left, top, right, bottom = bounds
    color = ImageColor.getrgb(str(style["backgroundColor"]))
    opacity = float(style["backgroundOpacity"])
    background = style["background"]
    if background["mode"] == "verticalGradient":
        panel = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
        pixels = panel.load()
        top_alpha = float(background["gradientTopOpacity"]) * opacity
        bottom_alpha = float(background["gradientBottomOpacity"]) * opacity
        height = max(1, panel.height - 1)
        for y in range(panel.height):
            alpha = round(255 * (top_alpha + (bottom_alpha - top_alpha) * y / height))
            for x in range(panel.width):
                pixels[x, y] = (*color, alpha)
        layer.alpha_composite(panel, (left, top))
    else:
        draw = ImageDraw.Draw(layer)
        draw.rounded_rectangle(
            bounds,
            radius=int(style["borderRadius"]),
            fill=(*color, round(255 * opacity)),
        )
    rule = str(background["topRule"])
    if rule != "none":
        rule_color = (*ImageColor.getrgb(str(background["topRuleColor"])),)
        alpha = round(255 * float(background["topRuleOpacity"]))
        draw = ImageDraw.Draw(layer)
        draw.line((left, top, right, top), fill=(*rule_color, alpha), width=1)
        if rule == "double":
            draw.line((left, top + 4, right, top + 4), fill=(*rule_color, alpha), width=1)


def _draw_name(
    draw: ImageDraw.ImageDraw,
    name: str,
    style: dict[str, Any],
    content: tuple[int, int, int, int],
    panel: tuple[int, int, int, int],
) -> int:
    if not name or style["speakerName"]["placement"] == "hidden":
        return content[1]
    placement = style["speakerName"]["placement"]
    size = round((style["speakerName"].get("fontSizePx") or 24) * float(style["fontScale"]))
    font = _font(FONT_MEDIUM, size)
    bbox = draw.textbbox((0, 0), name, font=font)
    width = bbox[2] - bbox[0]
    if placement.endswith("Center"):
        x = (panel[0] + panel[2] - width) // 2
    else:
        x = content[0]
    y = content[1] if placement.startswith("top") else panel[1] + 15
    color = ImageColor.getrgb(str(style["nameColor"]))
    draw.text(
        (x, y), name, font=font, fill=(*color, 255), stroke_width=1, stroke_fill=(0, 0, 0, 110)
    )
    if style["speakerName"].get("decoration") == "sideLines":
        middle = y + size // 2
        draw.line((x - 88, middle, x - 18, middle), fill=(*color, 150), width=1)
        draw.line((x + width + 18, middle, x + width + 88, middle), fill=(*color, 150), width=1)
    return y + round(size * 1.65) if placement.startswith("top") else max(content[1], y + size + 14)


def _draw_indicator(
    draw: ImageDraw.ImageDraw, style: dict[str, Any], panel: tuple[int, int, int, int]
) -> None:
    indicator = style["advanceIndicator"]
    if not indicator.get("visible") or not indicator.get("showInExport"):
        return
    left, top, right, bottom = panel
    x = left + 28 if str(indicator["position"]).endswith("Left") else right - 28
    y = top + 24 if str(indicator["position"]).startswith("top") else bottom - 24
    color = (*ImageColor.getrgb(str(style["textColor"])), 210)
    if indicator.get("style") == "compact":
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color)
    else:
        draw.polygon(((x - 7, y - 5), (x + 7, y - 5), (x, y + 7)), fill=color)


def render_dialogue_layer(
    *,
    text: str,
    name: str,
    configured_style: dict[str, Any] | None,
    runtime_preset: str | None,
    skin_path: Path | None = None,
) -> tuple[str, Path]:
    style = resolve_dialogue_style(configured_style, runtime_preset)
    fingerprint = hashlib.sha256(
        json.dumps(
            {"text": text, "name": name, "style": style, "skin": str(skin_path or "")},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    asset_id = f"generated-dialogue-{fingerprint[:32]}"
    cache = Path(tempfile.gettempdir()) / "future-props-galgame-dialogue-v2"
    output = cache / f"{fingerprint}.png"
    if output.is_file():
        return asset_id, output
    cache.mkdir(parents=True, exist_ok=True)
    layer = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    layout = style["layout"]
    width = round(1920 * float(layout["widthPercent"]) / 100)
    height = round(1080 * float(layout["heightPercent"]) / 100)
    bottom = round(1080 * (1 - float(layout["bottomOffsetPercent"]) / 100))
    left = (1920 - width) // 2
    panel = (left, bottom - height, left + width, bottom)
    if skin_path and skin_path.is_file():
        with Image.open(skin_path) as source:
            skin = source.convert("RGBA").resize((width, height), Image.Resampling.LANCZOS)
        layer.alpha_composite(skin, (left, bottom - height))
    else:
        _background(layer, style, panel)
    inset_x = round(width * float(layout["contentInsetXPercent"]) / 100)
    inset_top = round(height * float(layout["contentInsetTopPercent"]) / 100)
    inset_bottom = round(height * float(layout["contentInsetBottomPercent"]) / 100)
    content = (left + inset_x, panel[1] + inset_top, panel[2] - inset_x, bottom - inset_bottom)
    draw = ImageDraw.Draw(layer)
    text_y = _draw_name(draw, name, style, content, panel)
    body = style["body"]
    font_size = round((body.get("fontSizePx") or 32) * float(style["fontScale"]))
    font = _font(FONT_REGULAR, font_size)
    max_width = round((content[2] - content[0]) * float(body["maxWidthPercent"]) / 100)
    lines = _wrap(draw, text or "…", font, max_width)
    line_height = round(font_size * float(body["lineHeight"]))
    color = (*ImageColor.getrgb(str(style["textColor"])), 255)
    for line in lines:
        line_width = round(draw.textlength(line or " ", font=font))
        align = body["align"]
        x = content[0] if align == "left" else content[2] - line_width
        if align == "center":
            x = content[0] + (max_width - line_width) // 2
        draw.text(
            (x, text_y), line, font=font, fill=color, stroke_width=1, stroke_fill=(0, 0, 0, 120)
        )
        text_y += line_height
    _draw_indicator(draw, style, panel)
    temporary = output.with_suffix(".tmp")
    layer.save(temporary, format="PNG", optimize=False)
    os.replace(temporary, output)
    return asset_id, output
