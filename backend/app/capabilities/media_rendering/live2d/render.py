"""CPU textured triangle rasterizer for deterministic transparent PNG exports."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

from studio.contracts.media_rendering.character_document import CharacterDocument

from .evaluate import evaluate, parameter_values
from .idle import idle_pose


def coefficients(dst: list[tuple[float, float]], src: list[tuple[float, float]]) -> tuple | None:
    (x1, y1), (x2, y2), (x3, y3) = dst
    determinant = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
    if abs(determinant) < 1e-8:
        return None
    result = []
    for axis in (0, 1):
        z1, z2, z3 = [p[axis] for p in src]
        result.extend(
            (
                (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / determinant,
                (z1 * (x3 - x2) + z2 * (x1 - x3) + z3 * (x2 - x1)) / determinant,
                (z1 * (x2 * y3 - x3 * y2) + z2 * (x3 * y1 - x1 * y3) + z3 * (x1 * y2 - x2 * y1))
                / determinant,
            )
        )
    return tuple(result)


def render_frame(
    doc: CharacterDocument,
    assets: dict[str, Path],
    *,
    frame: float = 0,
    motion_id: str | None = None,
    expression_id: str | None = None,
    width: int | None = None,
    height: int | None = None,
    crop: tuple[float, float, float, float] | None = None,
    idle_time_ms: float | None = None,
) -> Image.Image:
    width, height = width or doc.width, height or doc.height
    cx, cy, cw, ch = crop or (0, 0, doc.width, doc.height)
    values = parameter_values(doc, frame, motion_id, expression_id)
    rotations = {}
    if idle_time_ms is not None:
        values, rotations = idle_pose(doc, values, idle_time_ms, motion_id, expression_id)
    parts, _ = evaluate(doc, values, rotations)
    layers: dict[str, Image.Image] = {}
    for part in parts:
        path = assets.get(part["assetId"])
        if path is None or not path.is_file():
            raise ValueError(f"素材缺失：{part['name']}")
        with Image.open(path) as source:
            texture = source.convert("RGBA")
        layer = Image.new("RGBA", (width, height))
        points = [
            ((p["x"] - cx) * width / cw, (p["y"] - cy) * height / ch) for p in part["worldVertices"]
        ]
        uvs = [(p["x"] * texture.width, p["y"] * texture.height) for p in part["uvs"]]
        for offset in range(0, len(part["triangles"]), 3):
            indices = part["triangles"][offset : offset + 3]
            dst = [points[i] for i in indices]
            x0 = max(0, math.floor(min(p[0] for p in dst)))
            y0 = max(0, math.floor(min(p[1] for p in dst)))
            x1 = min(width, math.ceil(max(p[0] for p in dst)))
            y1 = min(height, math.ceil(max(p[1] for p in dst)))
            if x1 <= x0 or y1 <= y0:
                continue
            local = [(x - x0, y - y0) for x, y in dst]
            coeff = coefficients(local, [uvs[i] for i in indices])
            if coeff is None:
                continue
            warped = texture.transform(
                (x1 - x0, y1 - y0), Image.Transform.AFFINE, coeff, Image.Resampling.BILINEAR
            )
            mask = Image.new("L", warped.size)
            ImageDraw.Draw(mask).polygon(local, fill=255)
            # Replace coverage instead of alpha-compositing shared triangle edges twice.
            layer.paste(warped, (x0, y0), mask)
        layer.putalpha(
            layer.getchannel("A").point(lambda a, opacity=part["opacity"]: round(a * opacity))
        )
        layers[part["id"]] = layer
    resolved: dict[str, Image.Image] = {}
    by_id = {p["id"]: p for p in parts}

    def masked(part_id: str) -> Image.Image:
        if part_id in resolved:
            return resolved[part_id]
        layer = layers[part_id].copy()
        mask_id = by_id[part_id]["maskId"]
        if mask_id:
            layer.putalpha(
                ImageChops.multiply(layer.getchannel("A"), masked(mask_id).getchannel("A"))
            )
        resolved[part_id] = layer
        return layer

    output = Image.new("RGBA", (width, height))
    for part in parts:
        if part["visible"]:
            output.alpha_composite(masked(part["id"]))
    return output
