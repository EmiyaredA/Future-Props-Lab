"""Editable freeform outlines matching the browser's shape catalog."""

import math


def points_for(kind: str, w: float, h: float):
    points = None
    if kind == "rightTriangle":
        points = [(0, 0), (w, h), (0, h)]
    if kind == "parallelogram":
        points = [(w * 0.25, 0), (w, 0), (w * 0.75, h), (0, h)]
    if kind == "trapezoid":
        points = [(w * 0.2, 0), (w * 0.8, 0), (w, h), (0, h)]
    if kind in {"pentagon", "hexagon", "star"}:
        count = 10 if kind == "star" else 5 if kind == "pentagon" else 6
        points = []
        for i in range(count):
            angle = -math.pi / 2 + i * math.pi * 2 / count
            radius = 0.42 if kind == "star" and i % 2 else 1
            points.append(
                (w / 2 + math.cos(angle) * w / 2 * radius, h / 2 + math.sin(angle) * h / 2 * radius)
            )
    arrow = [(0, 0.25), (0.65, 0.25), (0.65, 0), (1, 0.5), (0.65, 1), (0.65, 0.75), (0, 0.75)]
    if kind in {"leftArrow", "upArrow", "downArrow"}:
        points = [
            ((1 - x) * w, y * h)
            if kind == "leftArrow"
            else (y * w, (1 - x) * h)
            if kind == "upArrow"
            else ((1 - y) * w, x * h)
            for x, y in arrow
        ]
    if kind == "doubleArrow":
        points = [
            (x * w, y * h)
            for x, y in [
                (0, 0.5),
                (0.25, 0),
                (0.25, 0.25),
                (0.75, 0.25),
                (0.75, 0),
                (1, 0.5),
                (0.75, 1),
                (0.75, 0.75),
                (0.25, 0.75),
                (0.25, 1),
            ]
        ]
    if kind == "callout":
        points = [
            (0, 0),
            (w, 0),
            (w, h * 0.75),
            (w * 0.4, h * 0.75),
            (w * 0.18, h),
            (w * 0.22, h * 0.75),
            (0, h * 0.75),
        ]
    if kind == "roundCallout":
        r = min(16, w / 4, h / 4)
        points = []
        for cx, cy, start in [
            (w - r, r, -90),
            (w - r, h * 0.75 - r, 0),
            (r, h * 0.75 - r, 90),
            (r, r, 180),
        ]:
            for i in range(9):
                a = (start + i * 90 / 8) * math.pi / 180
                points.append((cx + r * math.cos(a), cy + r * math.sin(a)))
            if start == 0:
                points.extend([(w * 0.4, h * 0.75), (w * 0.18, h), (w * 0.22, h * 0.75)])
    if kind == "ellipseCallout":
        points = [
            (
                w / 2 + math.cos((120 + i * 330 / 64) * math.pi / 180) * w / 2,
                h * 0.38 + math.sin((120 + i * 330 / 64) * math.pi / 180) * h * 0.38,
            )
            for i in range(65)
        ]
        points.append((w * 0.15, h))
    return points


def freeform(slide, item, points):
    builder = slide.shapes.build_freeform(points[0][0], points[0][1], scale=9525)
    builder.add_line_segments(points[1:], close=True)
    # Keep the logical frame (and rotation center) even when a polygon does not
    # reach every side; pen moves add bounds without drawing extra segments.
    builder.move_to(0, 0).move_to(item.width, item.height)
    return builder.convert_to_shape(round(item.x * 9525), round(item.y * 9525))
