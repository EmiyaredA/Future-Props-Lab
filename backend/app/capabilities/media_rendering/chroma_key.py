"""Deterministic color-distance matte shared by frame and video exports."""

from PIL import Image, ImageChops

from app.capabilities.media_rendering.timeline_document import VideoEditorChromaKey


def apply_chroma_key(layer: Image.Image, key: VideoEditorChromaKey) -> Image.Image:
    if not key.enabled:
        return layer
    rgba = layer.convert("RGBA")
    red, green, blue, original_alpha = rgba.split()
    channels = [red, green, blue]
    target = tuple(bytes.fromhex(key.color[1:]))
    differences = [
        ImageChops.difference(channel, Image.new("L", rgba.size, value))
        for channel, value in zip(channels, target, strict=True)
    ]
    distance = ImageChops.add(
        ImageChops.add(
            differences[0].point(lambda value: value // 3),
            differences[1].point(lambda value: value // 3),
        ),
        differences[2].point(lambda value: value // 3),
    )
    threshold = key.similarity * 1.275
    width = max(1, key.softness * 0.51)

    def matte(value: int) -> int:
        progress = max(0.0, min(1.0, (value - threshold) / width))
        return round(255 * progress * progress * (3 - 2 * progress))

    matte_alpha = distance.point([matte(value) for value in range(256)])
    dominant = max(range(3), key=lambda index: target[index])
    others = [index for index in range(3) if index != dominant]
    excess = ImageChops.subtract(
        channels[dominant], ImageChops.lighter(channels[others[0]], channels[others[1]])
    )
    spill = ImageChops.multiply(excess, ImageChops.invert(matte_alpha))
    spill = spill.point([round(value * key.despill / 100) for value in range(256)])
    channels[dominant] = ImageChops.subtract(channels[dominant], spill)
    return Image.merge("RGBA", (*channels, ImageChops.multiply(original_alpha, matte_alpha)))
