"""Deterministic horizontal connector labels; mirrored by Web and shared vectors."""

import math

FONT_SIZE = 16
LINE_HEIGHT = 20
MAX_WIDTH = 240
PADDING_X = 6
PADDING_Y = 3


def advance(char, font_size=FONT_SIZE):
    code = ord(char)
    if 0x300 <= code <= 0x36F or code in (0x200D, 0xFE0F):
        return 0
    return font_size if code >= 0x2E80 else font_size / 2


def wrap_label(text, font_size=FONT_SIZE):
    lines = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line, width = "", 0
        for char in paragraph:
            size = advance(char, font_size)
            if line and width + size > MAX_WIDTH - PADDING_X * 2:
                lines.append(line)
                line, width = "", 0
            line += char
            width += size
        lines.append(line)
    return lines


def point_at(points, position=0.5):
    lengths = [
        math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        for a, b in zip(points[:-1], points[1:], strict=True)
    ]
    remaining = sum(lengths) * position
    for index, length in enumerate(lengths):
        if remaining <= length:
            ratio = remaining / length if length else 0
            a, b = points[index : index + 2]
            return {axis: a[axis] + (b[axis] - a[axis]) * ratio for axis in ("x", "y")}
        remaining -= length
    return dict(points[-1])


def label_layout(points, text, position=None, offset=None, font_size=FONT_SIZE):
    if not points or not text.strip():
        return None
    lines = wrap_label(text, font_size)
    width = max(
        24, max(sum(advance(char, font_size) for char in line) for line in lines) + PADDING_X * 2
    )
    height = len(lines) * font_size * 1.25 + PADDING_Y * 2
    anchor = point_at(points, 0.5 if position is None else position)
    offset = {"x": 0, "y": -16} if offset is None else offset
    return {
        "x": anchor["x"] + offset["x"] - width / 2,
        "y": anchor["y"] + offset["y"] - height / 2,
        "width": width,
        "height": height,
        "lines": lines,
    }
