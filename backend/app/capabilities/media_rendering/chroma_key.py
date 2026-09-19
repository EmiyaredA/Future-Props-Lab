"""Deterministic color-distance matte shared by frame and video exports."""

from PIL import Image, ImageChops, ImageFilter, ImageMath

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
    if key.despill:
        # Mixed edge pixels can contain less key green than red. Dominant-channel
        # subtraction misses them, so estimate the screen contribution only next
        # to the transparent matte and recover the foreground from that mixture.
        screen = Image.new("L", rgba.size, 255)
        high = max(target)
        for channel, value in zip(channels, target, strict=True):
            if value >= high - 16 and value:
                bound = channel.point([min(255, round(i * 255 / value)) for i in range(256)])
            elif value < 255:
                bound = channel.point(
                    [min(255, round((255 - i) * 255 / (255 - value))) for i in range(256)]
                )
            else:
                continue
            screen = ImageChops.darker(screen, bound)
        nearby = matte_alpha.point([255 if i == 0 else 0 for i in range(256)]).filter(
            ImageFilter.MaxFilter(5)
        )
        visible = matte_alpha.point([0] + [255] * 255)
        screen = ImageChops.multiply(screen, ImageChops.multiply(nearby, visible))
        screen = screen.point([min(254, round(i * key.despill / 100)) for i in range(256)])
        if screen.getbbox():
            channels = [
                ImageMath.lambda_eval(
                    lambda args, target_value=value: (
                        (args["channel"] - args["screen"] * target_value / 255)
                        * 255
                        / (255 - args["screen"])
                    ),
                    channel=channel,
                    screen=screen,
                ).convert("L")
                for channel, value in zip(channels, target, strict=True)
            ]
            matte_alpha = ImageChops.darker(matte_alpha, ImageChops.invert(screen))
    return Image.merge("RGBA", (*channels, ImageChops.multiply(original_alpha, matte_alpha)))
