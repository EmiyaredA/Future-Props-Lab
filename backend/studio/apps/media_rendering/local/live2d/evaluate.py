"""Pure parameter/keyform evaluator, mirrored by the browser with shared fixtures."""

from __future__ import annotations

import math
from copy import deepcopy

from studio.contracts.media_rendering.character_document import CharacterDocument


def interval(keys: list[dict], value: float, field: str) -> tuple[dict, dict, float]:
    ordered = sorted(keys, key=lambda k: k[field])
    if value <= ordered[0][field]:
        return ordered[0], ordered[0], 0
    for left, right in zip(ordered, ordered[1:], strict=False):
        if value <= right[field]:
            t = (value - left[field]) / (right[field] - left[field])
            return left, right, t
    return ordered[-1], ordered[-1], 0


def parameter_values(
    doc: CharacterDocument,
    frame: float = 0,
    motion_id: str | None = None,
    expression_id: str | None = None,
    overrides: dict | None = None,
) -> dict[str, float]:
    values = {p.id: p.default for p in doc.parameters}
    if expression_id:
        expression = next((e for e in doc.expressions if e.id == expression_id), None)
        if expression is None:
            raise ValueError("表情不存在")
        values.update(expression.values)
    if motion_id:
        motion = next((m for m in doc.motions if m.id == motion_id), None)
        if motion is None:
            raise ValueError("动作不存在")
        for track in motion.tracks:
            if not track.keys:
                continue
            a, b, t = interval([k.model_dump() for k in track.keys], frame, "frame")
            kind = a["interpolation"]
            t = 0 if kind == "hold" else t * t * (3 - 2 * t) if kind == "smooth" else t
            values[track.parameter_id] = a["value"] + (b["value"] - a["value"]) * t
    values.update(overrides or {})
    return {p.id: max(p.minimum, min(p.maximum, values[p.id])) for p in doc.parameters}


def sample(keys: list[dict], value: float) -> dict:
    a, b, t = interval(keys, value, "value")
    result = {}
    for field in ("rotation", "scale", "opacity", "offsetX", "offsetY"):
        if a.get(field) is not None:
            result[field] = a[field] + (b[field] - a[field]) * t
    if a.get("points") is not None:
        result["points"] = [
            {axis: x[axis] + (y[axis] - x[axis]) * t for axis in ("x", "y")}
            for x, y in zip(a["points"], b["points"], strict=True)
        ]
    return result


def evaluate(
    doc: CharacterDocument,
    values: dict[str, float],
    bone_rotations: dict[str, float] | None = None,
) -> tuple[list[dict], list[dict]]:
    data = doc.model_dump(by_alias=True)
    nodes = {n["id"]: deepcopy(n) for n in data["parts"] + data["deformers"] + data["bones"]}
    for parameter in data["parameters"]:
        value = values.get(parameter["id"], parameter["default"])
        for binding in parameter["bindings"]:
            target = nodes[binding["targetId"]]
            base = sample(binding["keys"], parameter["default"])
            posed = sample(binding["keys"], value)
            for field in ("rotation", "scale", "opacity", "offsetX", "offsetY"):
                if field in posed:
                    target[field] += posed[field] - base[field]
            if "points" in posed:
                field = "vertices" if "vertices" in target else "points"
                for index, point in enumerate(posed["points"]):
                    for axis in ("x", "y"):
                        target[field][index][axis] += point[axis] - base["points"][index][axis]
    for identifier, rotation in (bone_rotations or {}).items():
        if identifier in nodes and identifier in {bone["id"] for bone in data["bones"]}:
            nodes[identifier]["rotation"] += rotation
    for node in nodes.values():
        if "opacity" in node:
            node["opacity"] = max(0, min(1, node["opacity"]))
        if "scale" in node:
            node["scale"] = max(0.001, node["scale"])

    def transform(point: dict, parent: str | None) -> dict:
        x, y = point["x"], point["y"]
        while parent:
            d = nodes[parent]
            if d["kind"] == "rotation":
                angle = math.radians(d["rotation"])
                dx, dy = (x - d["x"]) * d["scale"], (y - d["y"]) * d["scale"]
                x = d["x"] + dx * math.cos(angle) - dy * math.sin(angle)
                y = d["y"] + dx * math.sin(angle) + dy * math.cos(angle)
            else:
                u = (x - d["x"]) / d["width"] * d["columns"]
                v = (y - d["y"]) / d["height"] * d["rows"]
                col = max(0, min(d["columns"] - 1, math.floor(u)))
                row = max(0, min(d["rows"] - 1, math.floor(v)))
                tx, ty = u - col, v - row
                at = row * (d["columns"] + 1) + col
                a, b, c, e = [
                    d["points"][i]
                    for i in (at, at + 1, at + d["columns"] + 1, at + d["columns"] + 2)
                ]

                def blend(axis: str, a=a, b=b, c=c, e=e, tx=tx, ty=ty) -> float:
                    return (a[axis] * (1 - tx) + b[axis] * tx) * (1 - ty) + (
                        c[axis] * (1 - tx) + e[axis] * tx
                    ) * ty

                x, y = blend("x"), blend("y")
            parent = d["parentId"]
        return {"x": x, "y": y}

    def skin(point: dict, weights: list[dict]) -> dict:
        blended_x = blended_y = 0.0
        for influence in weights:
            x, y = point["x"], point["y"]
            parent = influence["boneId"]
            while parent:
                bone = nodes[parent]
                angle = math.radians(bone["rotation"])
                dx, dy = (x - bone["x"]) * bone["scale"], (y - bone["y"]) * bone["scale"]
                x = bone["x"] + dx * math.cos(angle) - dy * math.sin(angle) + bone["offsetX"]
                y = bone["y"] + dx * math.sin(angle) + dy * math.cos(angle) + bone["offsetY"]
                parent = bone["parentId"]
            blended_x += x * influence["weight"]
            blended_y += y * influence["weight"]
        return {"x": blended_x, "y": blended_y}

    parts = []
    for source in data["parts"]:
        part = nodes[source["id"]]
        part["worldVertices"] = [
            skin({"x": p["x"] + part["x"], "y": p["y"] + part["y"]}, part["skinWeights"][i])
            if part["skinWeights"] is not None
            else transform({"x": p["x"] + part["x"], "y": p["y"] + part["y"]}, part["parentId"])
            for i, p in enumerate(part["vertices"])
        ]
        parts.append(part)
    return sorted(parts, key=lambda p: p["order"]), [nodes[d["id"]] for d in data["deformers"]]
