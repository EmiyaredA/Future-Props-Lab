"""Aspect-preserving source crops, shared semantically with the DOM renderer."""

from collections.abc import Mapping

from studio.apps.presentation_workshop.projects import PresentationError


def cover_crop(
    image_width: int,
    image_height: int,
    frame_width: float,
    frame_height: float,
    crop: Mapping[str, float],
) -> dict[str, float]:
    source_width = 1 - crop["left"] - crop["right"]
    source_height = 1 - crop["top"] - crop["bottom"]
    scale = max(
        frame_width / (image_width * source_width),
        frame_height / (image_height * source_height),
    )
    extra_x = max(0, (source_width - frame_width / (scale * image_width)) / 2)
    extra_y = max(0, (source_height - frame_height / (scale * image_height)) / 2)
    return {
        "left": crop["left"] + extra_x,
        "right": crop["right"] + extra_x,
        "top": crop["top"] + extra_y,
        "bottom": crop["bottom"] + extra_y,
    }


def pptx_crop(image_width, image_height, frame_width, frame_height, crop):
    result = {
        side: round(value * 100000) / 100000
        for side, value in cover_crop(
            image_width, image_height, frame_width, frame_height, crop
        ).items()
    }
    visible_width = image_width * (1 - result["left"] - result["right"])
    visible_height = image_height * (1 - result["top"] - result["bottom"])
    # DrawingML stores crops at 1/100000 precision. Never produce an empty
    # image or appreciable distortion when an extreme ratio cannot be represented.
    if (
        visible_width <= 0
        or visible_height <= 0
        or abs(frame_width * visible_height / (frame_height * visible_width) - 1) > 0.001
    ):
        raise PresentationError(
            "图片框比例过于极端，无法无变形导出；请调整图片框或裁剪范围",
            422,
            "export_crop_precision",
        )
    return result
