"""Pure card placement for nodes created by background generation.

Explicit API positions are never rewritten. Shared fixture tests keep this rule
and the browser's bounded obstacle-edge search in agreement.
"""

from math import isfinite

NODE_SIZE = {
    "text": {"width": 300, "height": 180},
    "image": {"width": 320, "height": 214},
    "video": {"width": 320, "height": 214},
    "audio": {"width": 300, "height": 132},
}
PLACEMENT_GAP = 32
COORDINATE_LIMIT = 1_000_000


def automatic_node_position(nodes: list[dict], kind: str, anchor: dict | None = None) -> dict:
    size = NODE_SIZE[kind]
    anchor = anchor or {"x": 80, "y": 80}
    if not all(isfinite(value) for value in (anchor["x"], anchor["y"])):
        raise ValueError("节点位置超出画布坐标范围")
    obstacles = [{**node["position"], **NODE_SIZE[node["kind"]]} for node in nodes]

    def clamp(point):
        return {
            "x": max(-COORDINATE_LIMIT, min(COORDINATE_LIMIT - size["width"], point["x"])),
            "y": max(-COORDINATE_LIMIT, min(COORDINATE_LIMIT - size["height"], point["y"])),
        }

    start = clamp(anchor)

    def free(point):
        return not any(
            point["x"] < other["x"] + other["width"] + PLACEMENT_GAP
            and point["x"] + size["width"] + PLACEMENT_GAP > other["x"]
            and point["y"] < other["y"] + other["height"] + PLACEMENT_GAP
            and point["y"] + size["height"] + PLACEMENT_GAP > other["y"]
            for other in obstacles
        )

    if free(start):
        return start
    candidates = []
    for other in obstacles:
        left = other["x"] - size["width"] - PLACEMENT_GAP
        right = other["x"] + other["width"] + PLACEMENT_GAP
        top = other["y"] - size["height"] - PLACEMENT_GAP
        bottom = other["y"] + other["height"] + PLACEMENT_GAP
        candidates.extend(
            [
                {"x": right, "y": start["y"]},
                {"x": start["x"], "y": bottom},
                {"x": left, "y": start["y"]},
                {"x": start["x"], "y": top},
                {"x": right, "y": bottom},
                {"x": left, "y": bottom},
                {"x": right, "y": top},
                {"x": left, "y": top},
            ]
        )

    def distance(point):
        return (point["x"] - start["x"]) ** 2 + (point["y"] - start["y"]) ** 2

    candidates.sort(key=distance)
    radius = max(size["width"], size["height"], 320) * 2
    for point in candidates:
        if distance(point) <= radius**2 and point == clamp(point) and free(point):
            return point
    fallbacks = [
        {"x": max(r["x"] + r["width"] for r in obstacles) + PLACEMENT_GAP, "y": start["y"]},
        {"x": start["x"], "y": max(r["y"] + r["height"] for r in obstacles) + PLACEMENT_GAP},
        {
            "x": min(r["x"] for r in obstacles) - size["width"] - PLACEMENT_GAP,
            "y": start["y"],
        },
        {
            "x": start["x"],
            "y": min(r["y"] for r in obstacles) - size["height"] - PLACEMENT_GAP,
        },
        *candidates,
    ]
    for point in fallbacks:
        bounded = clamp(point)
        if free(bounded):
            return bounded
    raise ValueError("附近没有可用位置，请移动节点后重试")
