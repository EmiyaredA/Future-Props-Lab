"""Deterministic directional motion and light; no runtime state or external assets."""

import math

import numpy as np
from PIL import Image, ImageChops


def whip_pan(layer: Image.Image, amount: float, direction: str) -> Image.Image:
    """Nine translated premultiplied samples, extending boundary pixels into the shutter."""
    amount = max(-1.0, min(1.0, amount))
    if abs(amount) < 0.000001:
        return layer
    horizontal = direction in {"left", "right"}
    sign = -1 if direction in {"left", "up"} else 1
    source = layer.convert("RGBa")
    width, height = source.size
    length = width if horizontal else height
    result = None
    for index in range(9):
        # JS and Python use the same half-up rounding, including negative offsets.
        shift = math.floor(
            sign * length * (amount * 0.30 + abs(amount) * 0.16 * (index / 8 - 0.5)) + 0.5
        )
        sample = Image.new("RGBa", source.size)
        sample.paste(source, (shift, 0) if horizontal else (0, shift))
        if horizontal and shift:
            column = source.crop((0, 0, 1, height) if shift > 0 else (width - 1, 0, width, height))
            sample.paste(
                column.resize((abs(shift), height)), (0 if shift > 0 else width + shift, 0)
            )
        elif shift:
            row = source.crop((0, 0, width, 1) if shift > 0 else (0, height - 1, width, height))
            sample.paste(row.resize((width, abs(shift))), (0, 0 if shift > 0 else height + shift))
        result = sample if result is None else Image.blend(result, sample, 1 / (index + 1))
    assert result is not None
    return result.convert("RGBA")


def light_leak_strip(length: int, progress: float, direction: str) -> Image.Image:
    """RGB screen-blend strip, matching the browser's lightLeakStrip pixel formula."""
    progress = max(0.0, min(1.0, progress))
    envelope = math.sin(math.pi * progress)
    coordinate = (np.arange(length, dtype=np.float64) + 0.5) / length
    if direction in {"left", "up"}:
        coordinate = 1 - coordinate
    center = -0.55 + 2.1 * progress
    distance = coordinate - center
    bloom = np.exp(-0.5 * (distance / 0.28) ** 2) * envelope
    core = np.exp(-0.5 * (distance / 0.10) ** 2) * envelope
    colors = np.stack(
        (0.86 * bloom + 0.30 * core, 0.95 * bloom + 0.25 * core, 0.38 * bloom + 0.70 * core), axis=1
    )
    pixels = np.floor(np.clip(colors, 0, 1) * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(pixels.reshape(1, length, 3))


def light_leak(layer: Image.Image, progress: float, direction: str) -> Image.Image:
    """Sweep yellow-green light over the program frame without changing its alpha."""
    if progress <= 0 or progress >= 1:
        return layer
    width, height = layer.size
    horizontal = direction in {"left", "right"}
    strip = light_leak_strip(width if horizontal else height, progress, direction)
    if not horizontal:
        strip = strip.transpose(Image.Transpose.TRANSPOSE)
    illumination = strip.resize(layer.size, Image.Resampling.NEAREST)
    result = ImageChops.screen(layer.convert("RGB"), illumination).convert("RGBA")
    result.putalpha(layer.getchannel("A"))
    return result
