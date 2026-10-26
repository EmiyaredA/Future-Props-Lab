"""Clip-local pulses that never change source sampling or timeline duration."""

import math
from collections.abc import Iterable

from PIL import Image, ImageFilter

from app.capabilities.media_rendering.audio_transitions import eased_progress
from app.capabilities.media_rendering.directional_transitions import light_leak, whip_pan
from app.capabilities.media_rendering.spin_blur import spin_blur
from app.capabilities.media_rendering.timeline_document import VideoEditorTimedEffect


def effect_progress(
    effect: VideoEditorTimedEffect, local_us: int, frame_duration_us: float = 0
) -> float | None:
    elapsed = local_us - effect.start_us
    if not 0 <= elapsed < effect.duration_us:
        return None
    # A camera flash may occupy exactly one output frame. Sampling its first
    # instant at sin(0) must not make that entire flash disappear.
    position = (
        0.5
        if effect.kind == "flash" and effect.duration_us <= math.floor(frame_duration_us + 0.5)
        else elapsed / effect.duration_us
    )
    phase = effect.progress_start + (effect.progress_end - effect.progress_start) * position
    return eased_progress(phase, effect.easing)


def apply_timed_effects(
    layer: Image.Image,
    effects: Iterable[VideoEditorTimedEffect],
    local_us: int,
    *,
    frame_duration_us: float = 0,
) -> Image.Image:
    for effect in effects:
        progress = effect_progress(effect, local_us, frame_duration_us)
        if progress is None or progress <= 0 or progress >= 1:
            continue
        amount = math.sin(math.pi * progress)
        if effect.kind == "whip-pan":
            layer = whip_pan(layer, amount, effect.direction)
        elif effect.kind == "spin-blur":
            layer = spin_blur(layer, amount)
        elif effect.kind == "blur":
            layer = (
                layer.convert("RGBa")
                .filter(ImageFilter.GaussianBlur(round(10 * amount)))
                .convert("RGBA")
            )
        elif effect.kind == "zoom":
            width, height = layer.size
            scale = 1 + 0.22 * amount
            enlarged = layer.resize(
                (round(width * scale), round(height * scale)), Image.Resampling.BICUBIC
            )
            left, top = (enlarged.width - width) // 2, (enlarged.height - height) // 2
            layer = enlarged.crop((left, top, left + width, top + height))
        elif effect.kind == "flash":
            alpha = layer.getchannel("A")
            layer = Image.blend(
                layer, Image.new("RGBA", layer.size, "white"), round(230 * amount) / 255
            )
            layer.putalpha(alpha)
        elif effect.kind == "light-leak":
            layer = light_leak(layer, progress, effect.direction)
    return layer
