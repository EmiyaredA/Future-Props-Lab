"""Angular motion blur shared by clip edges and seam transitions."""

import math

from PIL import Image


def spin_blur(layer: Image.Image, amount: float) -> Image.Image:
    """Average nine rotated samples; amount is signed and normalized to [-1, 1]."""
    amount = max(-1.0, min(1.0, amount))
    if abs(amount) < 0.000001:
        return layer
    width, height = layer.size
    source = layer.convert("RGBa")
    result = None
    for index in range(9):
        angle = math.radians(amount * (45 + (index / 8 - 0.5) * 24))
        cosine, sine = math.cos(angle), math.sin(angle)
        # Enlarge enough to keep every rotated sample covering the source bounds.
        scale = max(
            abs(cosine) + height / width * abs(sine),
            abs(cosine) + width / height * abs(sine),
        )
        a, b = cosine / scale, sine / scale
        sample = source.transform(
            source.size,
            Image.Transform.AFFINE,
            (
                a,
                b,
                width / 2 - a * width / 2 - b * height / 2,
                -b,
                a,
                height / 2 + b * width / 2 - a * height / 2,
            ),
            resample=Image.Resampling.BICUBIC,
        )
        result = sample if result is None else Image.blend(result, sample, 1 / (index + 1))
    assert result is not None
    return result.convert("RGBA")
