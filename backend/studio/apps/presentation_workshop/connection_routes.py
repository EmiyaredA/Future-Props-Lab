"""Pure route rebasing shared by batch edits and verified against Web vectors."""

import math


def near(a, b):
    return abs(a - b) < 0.000001


def same(a, b):
    return near(a["x"], b["x"]) and near(a["y"], b["y"])


def anchor(element, side, offset=0.5):
    x = element["x"] + (
        0 if side == "left" else element["width"] if side == "right" else element["width"] * offset
    )
    y = element["y"] + (
        0
        if side == "top"
        else element["height"]
        if side == "bottom"
        else element["height"] * offset
    )
    angle = math.radians(element["rotation"])
    cx, cy = element["x"] + element["width"] / 2, element["y"] + element["height"] / 2
    return {
        "x": cx + (x - cx) * math.cos(angle) - (y - cy) * math.sin(angle),
        "y": cy + (x - cx) * math.sin(angle) + (y - cy) * math.cos(angle),
    }


def checked_waypoints(points):
    result = []
    for point in points:
        if any(not math.isfinite(v) or abs(v) > 10000 for v in point.values()):
            raise ValueError("走线超出坐标或 32 个路径点限制，请简化路径后再调整")
        if result and same(result[-1], point):
            continue
        while len(result) > 1:
            a, b = result[-2:]
            cross = (b["x"] - a["x"]) * (point["y"] - b["y"]) - (b["y"] - a["y"]) * (
                point["x"] - b["x"]
            )
            dot = (b["x"] - a["x"]) * (point["x"] - b["x"]) + (b["y"] - a["y"]) * (
                point["y"] - b["y"]
            )
            if not near(cross, 0) or dot < 0:
                break
            result.pop()
        result.append(dict(point))
    waypoints = result[1:-1]
    if len(waypoints) > 32:
        raise ValueError("走线超出坐标或 32 个路径点限制，请简化路径后再调整")
    return waypoints


def bridge(next_point, previous, adjacent):
    if same(next_point, previous):
        return []
    if near(previous["x"], adjacent["x"]):
        return [{"x": next_point["x"], "y": adjacent["y"]}]
    if near(previous["y"], adjacent["y"]):
        return [{"x": adjacent["x"], "y": next_point["y"]}]
    return []


def attach_end(next_point, previous, points, neighbor):
    adjacent = points[0]
    if same(next_point, previous):
        return []
    following = points[1] if len(points) > 1 else neighbor
    if near(previous["y"], adjacent["y"]) and near(adjacent["x"], following["x"]):
        adjacent["y"] = next_point["y"]
        return []
    if near(previous["x"], adjacent["x"]) and near(adjacent["y"], following["y"]):
        adjacent["x"] = next_point["x"]
        return []
    return bridge(next_point, previous, adjacent)


def follow_connection(before, after, edge):
    points = edge.get("waypoints", [])
    old = next((c for c in before["connections"] if c["id"] == edge["id"]), None)
    if not points or old is None or edge["style"] == "straight":
        return edge
    bindings = ("source_id", "target_id", "source_anchor", "target_anchor")
    if any(old.get(k) != edge.get(k) for k in ("source_point", "target_point")):
        return edge
    if any(old[k] != edge[k] for k in bindings):
        return edge
    if any(old.get(k, 0.5) != edge.get(k, 0.5) for k in ("source_offset", "target_offset")):
        return edge
    previous = {e["id"]: e for e in before["elements"]}
    current = {e["id"]: e for e in after["elements"]}

    def endpoint(elements, end):
        point = edge.get(f"{end}_point")
        if point is not None:
            return point
        element = elements.get(edge[f"{end}_id"])
        return (
            anchor(element, edge[f"{end}_anchor"], edge.get(f"{end}_offset", 0.5))
            if element
            else None
        )

    a, b = endpoint(previous, "source"), endpoint(previous, "target")
    c, d = endpoint(current, "source"), endpoint(current, "target")
    if any(p is None for p in (a, b, c, d)):
        return edge
    if same(a, c) and same(b, d):
        return edge
    dx, dy = c["x"] - a["x"], c["y"] - a["y"]
    inner = [dict(p) for p in points]
    translation = all(
        edge[k] is None or previous[edge[k]][field] == current[edge[k]][field]
        for k in ("source_id", "target_id")
        for field in ("width", "height", "rotation")
    )
    if translation and near(dx, d["x"] - b["x"]) and near(dy, d["y"] - b["y"]):
        route = [c, *({"x": p["x"] + dx, "y": p["y"] + dy} for p in inner), d]
    else:
        start = attach_end(c, a, inner, b)
        inner.reverse()
        end = attach_end(d, b, inner, c)
        inner.reverse()
        route = [c, *start, *inner, *reversed(end), d]
    return {**edge, "waypoints": checked_waypoints(route)}


def follow_batch(before, after, explicit_paths):
    old_slides = {s["id"]: s for s in before["slides"]}
    for slide in after["slides"]:
        old = old_slides.get(slide["id"])
        if old is None:
            continue
        old_edges = {c["id"]: c for c in old["connections"]}
        for i, edge in enumerate(slide["connections"]):
            if (slide["id"], edge["id"]) in explicit_paths:
                continue
            previous = old_edges.get(edge["id"])
            if (
                previous
                and any(
                    previous.get(k) != edge.get(k)
                    for k in (
                        "source_id",
                        "target_id",
                        "source_anchor",
                        "target_anchor",
                        "style",
                        "source_point",
                        "target_point",
                    )
                )
                or (
                    previous
                    and any(
                        previous.get(k, 0.5) != edge.get(k, 0.5)
                        for k in ("source_offset", "target_offset")
                    )
                )
            ):
                slide["connections"][i] = {**edge, "waypoints": []}
            else:
                slide["connections"][i] = follow_connection(old, slide, edge)
