"""Bounded, self-contained SVG subset shared by preview, storage and export."""

import math
import re
from xml.etree import ElementTree as ET

from defusedxml.ElementTree import fromstring
from PIL import ImageColor

MAX_SVG_BYTES = 2 * 1024 * 1024
NS = "http://www.w3.org/2000/svg"
TAGS = {
    "svg",
    "g",
    "defs",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "use",
    "title",
    "desc",
}
ATTRS = {
    "id",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "transform",
    "fill",
    "stroke",
    "fill-rule",
    "clip-rule",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "color",
    "clip-path",
    "mask",
    "href",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "offset",
    "stop-color",
    "stop-opacity",
    "fx",
    "fy",
    "fr",
    "clipPathUnits",
    "maskUnits",
    "maskContentUnits",
    "preserveAspectRatio",
    "version",
    "vector-effect",
}
STYLE = {
    "fill",
    "stroke",
    "fill-rule",
    "clip-rule",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "color",
    "stop-color",
    "stop-opacity",
    "clip-path",
    "mask",
}
ET.register_namespace("", NS)


def normalize_svg(source: str) -> dict:
    if len(source.encode()) > MAX_SVG_BYTES:
        raise ValueError("SVG 不能超过 2 MiB")
    try:
        root = fromstring(source, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except Exception as exc:
        raise ValueError("SVG XML 无效，不允许 DTD 或实体") from exc
    if root.tag not in {"svg", f"{{{NS}}}svg"}:
        raise ValueError("文件必须以 SVG 根元素开始")
    nodes = list(root.iter())
    if len(nodes) > 3000:
        raise ValueError("SVG 最多包含 3000 个节点")
    ids, references, colors = {}, [], set()
    path_size = 0
    gradients = False

    def visit(
        node, depth=0, inherited_fill="#000000", inherited_stroke="none", inherited_color="#000000"
    ):
        nonlocal path_size, gradients
        if depth > 64:
            raise ValueError("SVG 嵌套层级过深")
        tag = node.tag.removeprefix(f"{{{NS}}}")
        if tag not in TAGS:
            raise ValueError(f"不支持 SVG 元素 {tag}；文字请先转路径")
        node.tag = f"{{{NS}}}{tag}"
        gradients |= tag in {"linearGradient", "radialGradient", "mask"}
        style = node.attrib.pop("style", "")
        for entry in style.split(";"):
            if not entry.strip():
                continue
            key, sep, value = entry.partition(":")
            if not sep or key.strip() not in STYLE:
                raise ValueError("SVG 包含不支持的样式")
            node.set(key.strip(), value.strip())
        for key, value in list(node.attrib.items()):
            local = key.removeprefix("{http://www.w3.org/1999/xlink}")
            if local not in ATTRS or re.search(r"[\\<>]|@|javascript:|data:", value, re.I):
                raise ValueError(f"不支持 SVG 属性 {local}")
            if len(value) > 100000:
                raise ValueError("SVG 属性过长")
            if key != local:
                del node.attrib[key]
                node.set(local, value)
            if local in {"d", "points"}:
                path_size += len(value)
            if local == "id":
                if value in ids or not re.fullmatch(r"[\w.-]+", value):
                    raise ValueError("SVG ID 无效或重复")
                ids[value] = node
            if local == "href":
                if not re.fullmatch(r"#[\w.-]+", value):
                    raise ValueError("SVG 不允许引用外部资源")
                references.append((node, value[1:]))
            if "url" in value.lower():
                match = re.fullmatch(r"url\(\s*#([\w.-]+)\s*\)", value)
                if not match or local not in {"fill", "stroke", "clip-path", "mask"}:
                    raise ValueError("SVG 仅允许内部资源引用")
                references.append((node, match[1]))
            if local in {"fill", "stroke", "color", "stop-color"} and not value.startswith("url("):
                if value not in {"none", "currentColor", "inherit"}:
                    try:
                        rgb = ImageColor.getrgb(value)
                        if len(rgb) != 3:
                            raise ValueError()
                        node.set(local, f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}")
                    except ValueError as exc:
                        raise ValueError("SVG 颜色无效；透明度请使用 opacity") from exc
        fill = node.get("fill", inherited_fill)
        stroke = node.get("stroke", inherited_stroke)
        fill = inherited_fill if fill == "inherit" else fill
        stroke = inherited_stroke if stroke == "inherit" else stroke
        color = node.get("color", inherited_color)
        color = inherited_color if color in {"inherit", "currentColor"} else color
        if tag in {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use"}:
            for paint in (fill, stroke):
                if paint != "none":
                    colors.add(color if paint == "currentColor" else paint)
        for child in node:
            visit(child, depth + 1, fill, stroke, color)

    visit(root)
    if path_size > 500000:
        raise ValueError("SVG 路径过于复杂")
    graph = {id(n): [id(c) for c in n] for n in nodes}
    for node, target in references:
        if target not in ids:
            raise ValueError("SVG 内部引用不存在")
        graph[id(node)].append(id(ids[target]))
    visiting, expanded = set(), {}

    def cycle(key, depth=0):
        if key in visiting or depth > 64:
            raise ValueError("SVG 包含循环或过深引用")
        if key in expanded:
            return expanded[key]
        visiting.add(key)
        count = 1
        for child in graph[key]:
            count += cycle(child, depth + 1)
            if count > 10000:
                raise ValueError("SVG 引用展开后过于复杂")
        visiting.remove(key)
        expanded[key] = count
        return count

    cycle(id(root))
    try:
        view = (
            [float(v) for v in re.split(r"[\s,]+", root.get("viewBox", "").strip())]
            if root.get("viewBox")
            else []
        )
        if view and (len(view) != 4 or not all(math.isfinite(v) for v in view)):
            raise ValueError()
        width = float(root.get("width", str(view[2] if view else 0)).removesuffix("px"))
        height = float(root.get("height", str(view[3] if view else 0)).removesuffix("px"))
        if not (0 < width <= 10000 and 0 < height <= 10000) or (
            view and (view[2] <= 0 or view[3] <= 0)
        ):
            raise ValueError()
    except (ValueError, IndexError) as exc:
        raise ValueError("SVG 需要有效的 viewBox 或宽高（最大 10000）") from exc
    root.set("width", str(width))
    root.set("height", str(height))
    if not view:
        root.set("viewBox", f"0 0 {width} {height}")
    return {
        "svg": ET.tostring(root, encoding="unicode"),
        "width": width,
        "height": height,
        "monochrome": not gradients and len(colors) == 1,
    }


def tint_svg(source: str, color: str | None) -> str:
    result = normalize_svg(source)
    if not color:
        return result["svg"]
    if not result["monochrome"]:
        raise ValueError("多色 SVG 不支持统一改色")
    root = fromstring(result["svg"])
    if root.get("fill") != "none":
        root.set("fill", color)
    for node in root.iter():
        for key in ("fill", "stroke", "color"):
            if key in node.attrib and node.get(key) != "none":
                node.set(key, color)
    return ET.tostring(root, encoding="unicode")
