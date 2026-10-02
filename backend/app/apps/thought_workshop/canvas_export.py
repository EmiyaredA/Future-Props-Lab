"""Inert SVG projection of validated canvas scenes for portable HTML exports.

Positions are absolute, including frame members. Keep geometry and text wrapping
aligned with the Web CanvasSvg projection; no foreignObject, HTML or user SVG.
"""

import json
import math
import re
from html import escape
from uuid import uuid4
from xml.etree.ElementTree import Element, SubElement, tostring

import mistune

from app.apps.thought_workshop.schemas.canvas import remap_canvas, validate_canvas

ICON_PATHS = {
    "code": "M8 5l-6 7 6 7 M16 5l6 7-6 7 M14 3l-4 18",
    "globe": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M2 12h20 M12 2c-6 6-6 14 0 20 6-6 6-14 0-20",
    "clock": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6l4 2",
    "mail": "M2 4h20v16H2z M2 4l10 8 10-8",
    "lock": "M5 10h14v12H5z M8 10V6a4 4 0 0 1 8 0v4",
    "network": "M12 2v8 M3 22v-8h18v8 M3 18h18 M12 10v12",
    "server": "M3 3h18v7H3z M3 14h18v7H3z M6 6h2 M6 17h2",
    "database": "M3 5c0-4 18-4 18 0s-18 4-18 0v14c0 4 18 4 18 0V5 M3 12c0 4 18 4 18 0",
    "user": "M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 22v-3a8 8 0 0 1 16 0v3",
    "file": "M4 2h10l6 6v14H4z M14 2v6h6 M8 13h8 M8 17h8",
    "cloud": "M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 0 12z",
    "cpu": "M6 6h12v12H6z M9 1v5 M15 1v5 M9 18v5 M15 18v5 M1 9h5 M1 15h5 M18 9h5 M18 15h5",
}


def add(parent, tag, attrs=None, text=None):
    element = SubElement(parent, tag, {key: str(value) for key, value in (attrs or {}).items()})
    element.text = text
    return element


def wrapped_lines(text, width, size=15):
    available = max(size, width - 24)
    lines = []
    for paragraph in text.split("\n"):
        line, used = "", 0
        for character in paragraph:
            advance = (8 if ord(character) <= 0x7F else 15) * size / 15
            if line and used + advance > available:
                lines.append(line)
                line, used = "", 0
            line += character
            used += advance
        lines.append(line)
    return lines


def text_color(item):
    if item["kind"] in {"frame", "text"}:
        return "#20383d"
    r, g, b = (int(item["fill"][start : start + 2], 16) for start in (1, 3, 5))
    return "#ffffff" if r * 0.299 + g * 0.587 + b * 0.114 < 128 else "#20383d"


def shape(root, item, images):
    w, h, kind = item["width"], item["height"], item["kind"]
    group = add(root, "g", {"transform": f"translate({item['x']},{item['y']})"})
    common = {"fill": item["fill"], "stroke": item["stroke"], "stroke-width": 2}
    if kind == "ellipse":
        add(
            group, "ellipse", {"cx": w / 2, "cy": h / 2, "rx": w / 2 - 2, "ry": h / 2 - 2, **common}
        )
    elif kind == "diamond":
        add(
            group,
            "polygon",
            {"points": f"{w / 2},2 {w - 2},{h / 2} {w / 2},{h - 2} 2,{h / 2}", **common},
        )
    elif kind != "text":
        add(
            group,
            "rect",
            {
                "x": 1,
                "y": 1,
                "width": w - 2,
                "height": h - 2,
                "rx": 14 if kind == "rounded" else 2,
                **common,
                **({"fill-opacity": 0.35, "stroke-dasharray": "6 4"} if kind == "frame" else {}),
            },
        )
    if kind == "image":
        # Paths are supplied exclusively by the export's managed-resource map.
        path = images.get(item["assetId"])
        if path is not None:
            add(
                group,
                "image",
                {"href": path, "width": w, "height": h, "preserveAspectRatio": "xMidYMid meet"},
            )
        else:
            add(group, "text", {"x": 10, "y": 30, "fill": "#8a3e2a"}, "图片资源缺失")
        return
    if kind == "icon":
        icon = add(
            group,
            "g",
            {
                "transform": f"translate({w / 2 - 12},12)",
                "fill": "none",
                "stroke": item["stroke"],
                "stroke-width": 1.7,
            },
        )
        add(icon, "path", {"d": ICON_PATHS[item.get("icon", "server")]})
    size = item.get("fontSize", 15)
    line_height = size * 4 / 3
    align = item.get("textAlign", "left" if kind == "frame" else "center")
    limit = max(1, math.floor((h - (42 if kind == "icon" else 12)) / line_height))
    lines = wrapped_lines(item["text"], w, size)[:limit]
    text = add(
        group,
        "text",
        {
            "font-family": "system-ui, sans-serif",
            "font-size": size,
            "fill": text_color(item),
            "text-anchor": {"left": "start", "center": "middle", "right": "end"}[align],
        },
    )
    for index, line in enumerate(lines):
        y = (
            size + 9
            if kind == "frame"
            else 55
            if kind == "icon"
            else max(22, h / 2 - (len(lines) - 1) * line_height / 2 + size / 3)
        )
        add(
            text,
            "tspan",
            {
                "x": 12 if align == "left" else w - 12 if align == "right" else w / 2,
                "y": y + index * line_height,
            },
            line,
        )


def canvas_svg(scene, images):
    validate_canvas(scene)
    elements = scene["elements"]
    x = min(e["x"] for e in elements) - 24 if elements else -24
    y = min(e["y"] for e in elements) - 24 if elements else -24
    width = (max(e["x"] + e["width"] for e in elements) if elements else 400) - x + 24
    height = (max(e["y"] + e["height"] for e in elements) if elements else 180) - y + 24
    root = Element(
        "svg",
        {
            "xmlns": "http://www.w3.org/2000/svg",
            "viewBox": f"{x} {y} {width} {height}",
            "role": "img",
            "aria-label": scene["title"],
        },
    )
    add(root, "title", text=scene["title"])
    add(root, "desc", text="；".join(e["text"] for e in elements))
    marker_id = "arrow-" + uuid4().hex
    marker = add(
        add(root, "defs"),
        "marker",
        {
            "id": marker_id,
            "markerWidth": 10,
            "markerHeight": 10,
            "refX": 8,
            "refY": 4,
            "orient": "auto",
        },
    )
    add(
        marker,
        "path",
        {"d": "M0 0L8 4L0 8", "fill": "none", "stroke": "#365f62", "stroke-width": 1.5},
    )
    for element in elements:
        if element["kind"] == "frame":
            shape(root, element, images)
    by_id = {item["id"]: item for item in elements}
    for edge in scene["edges"]:
        a, b = by_id[edge["source"]], by_id[edge["target"]]

        def point(item, side):
            return (
                item["x"]
                + (
                    0 if side == "left" else item["width"] if side == "right" else item["width"] / 2
                ),
                item["y"]
                + (
                    0
                    if side == "top"
                    else item["height"]
                    if side == "bottom"
                    else item["height"] / 2
                ),
            )

        x1, y1 = point(a, edge.get("sourceAnchor", "right"))
        x2, y2 = point(b, edge.get("targetAnchor", "left"))
        path = f"M{x1},{y1} L{x2},{y2}"
        if edge["style"] == "step":
            path = (
                f"M{x1},{y1} V{(y1 + y2) / 2} H{x2} V{y2}"
                if edge.get("sourceAnchor") in {"top", "bottom"}
                else f"M{x1},{y1} H{(x1 + x2) / 2} V{y2} H{x2}"
            )
        add(
            root,
            "path",
            {
                "d": path,
                "fill": "none",
                "stroke": "#365f62",
                "stroke-width": 2,
                **({"marker-end": f"url(#{marker_id})"} if edge["arrow"] else {}),
            },
        )
        add(
            root,
            "text",
            {
                "x": (x1 + x2) / 2,
                "y": (y1 + y2) / 2 - 8,
                "text-anchor": "middle",
                "font-size": 13,
                "font-family": "system-ui, sans-serif",
                "fill": "#20383d",
                "stroke": "#fff",
                "stroke-width": 4,
                "paint-order": "stroke",
            },
            edge["label"],
        )
    for element in elements:
        if element["kind"] != "frame":
            shape(root, element, images)
    return tostring(root, encoding="unicode")


class CanvasHtmlRenderer(mistune.HTMLRenderer):
    def __init__(self, scenes):
        super().__init__(escape=True)
        self.scenes = scenes

    def block_quote(self, text):
        match = re.match(r"<p>\[!(INFO|NOTE|SUCCESS|WARNING|DANGER)\]</p>\s*(.*)", text, re.S)
        if match:
            return f'<aside data-callout="{match[1].lower()}">{match[2]}</aside>\n'
        return super().block_quote(text)

    def link(self, text, url, title=None):
        if url.startswith(("fpl-note:", "fpl-official:")):
            # Single-document server exports do not include reference targets.
            return f'<span class="document-reference">{text}（未包含在本次导出）</span>'
        return super().link(text, url, title)

    def block_code(self, code, info=None):
        # Only substitute exact generated source blocks from actual canvas nodes.
        # A user code block named fpl-canvas remains ordinary escaped source.
        if info == "fpl-canvas" and code.strip() in self.scenes:
            scene, images = self.scenes[code.strip()]
            return (
                '<figure class="fpl-canvas">'
                + canvas_svg(scene, images)
                + "<figcaption>"
                + escape(scene["title"])
                + "</figcaption></figure>\n"
            )
        return super().block_code(code, info)


def canvas_sources(document, paths):
    scenes = {}

    def walk(node):
        if node["type"] == "canvas":
            original = node["attrs"]["scene"]
            portable = remap_canvas(original, paths)
            source = json.dumps(portable, ensure_ascii=False).replace("`", "\\u0060")
            scenes[source] = (original, paths)
        for child in node.get("content", []):
            walk(child)

    walk(document)
    return scenes
