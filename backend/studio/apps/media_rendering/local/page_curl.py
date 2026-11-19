"""Deterministic cylindrical paper curl; mirrored by pageCurlCanvas.ts."""

import math

import numpy as np
from PIL import Image


def page_curl(layer: Image.Image, progress: float, direction: str) -> Image.Image:
    """Roll away a page, preserving source alpha and exposing a transparent backdrop.

    Coordinates are normalized to the fitted layer. The tilted cylinder travels
    from the right edge toward the left; direction=right mirrors geometry only.
    Its back face takes precedence over its front where they overlap.
    """
    progress = max(0.0, min(1.0, progress))
    if progress == 0:
        return layer
    if progress == 1:
        return Image.new("RGBA", layer.size)
    source = np.asarray(layer.convert("RGBA"))
    height, width = source.shape[:2]
    u = (np.arange(width, dtype=np.float64)[None, :] + 0.5) / width
    if direction == "right":
        u = 1 - u
    tilt = 0.20 * ((np.arange(height, dtype=np.float64)[:, None] + 0.5) / height - 0.5)
    fold = 1.10 - 1.20 * progress
    envelope = math.sin(math.pi * progress)
    radius = 0.16 * envelope
    distance = u + tilt - fold
    # Only the cylinder needs inverse mapping. Keep flat pixels byte-for-byte and
    # avoid allocating full-frame RGB float buffers for each exported frame.
    pixels = source.copy()
    pixels[distance >= 0] = 0
    rows, columns = np.nonzero((distance >= 0) & (distance <= radius))
    z = np.clip(distance[rows, columns] / radius, 0, 1)
    angle = np.arcsin(z)
    back_u = fold + radius * (math.pi - angle) - tilt[rows, 0]
    front_u = fold + radius * angle - tilt[rows, 0]
    back = (back_u >= 0) & (back_u < 1)
    sample_u = np.where(back, back_u, front_u)
    valid = (sample_u >= 0) & (sample_u < 1)
    if direction == "right":
        sample_u = 1 - sample_u
    sample_x = np.clip(np.floor(sample_u * width).astype(np.int32), 0, width - 1)
    sampled = source[rows, sample_x].copy()
    shade = 0.70 + 0.30 * np.sqrt(1 - z * z)
    highlight = 0.08 * np.exp(-(((z - 0.82) / 0.12) ** 2))
    paper = sampled[:, :3] * 0.18 + np.array([248, 245, 235]) * 0.82
    rgb = np.where(back[:, None], paper, sampled[:, :3])
    sampled[:, :3] = np.floor(np.clip(rgb * (shade + highlight)[:, None], 0, 255) + 0.5)
    pixels[rows[valid], columns[valid]] = sampled[valid]

    # A bounded shadow follows the cylinder, rather than darkening the whole frame.
    shadow_width = 0.045 * envelope
    rows, columns = np.nonzero((distance > radius) & (distance < radius + shadow_width))
    crest_u = fold + radius * math.pi / 2 - tilt[rows, 0]
    valid = (crest_u >= 0) & (crest_u < 1)
    if direction == "right":
        crest_u = 1 - crest_u
    crest_x = np.clip(np.floor(crest_u * width).astype(np.int32), 0, width - 1)
    alpha = source[rows, crest_x, 3]
    strength = 0.22 * envelope * (1 - (distance[rows, columns] - radius) / shadow_width) ** 2
    pixels[rows[valid], columns[valid], 3] = np.floor(alpha[valid] * strength[valid] + 0.5)
    return Image.fromarray(pixels)
