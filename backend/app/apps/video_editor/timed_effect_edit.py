"""Preserve a pulse's original phase while editing a clip's local time range."""

from copy import deepcopy
from math import floor


def crop_timed_effects(clip: dict, offset_us: int, duration_us: int) -> list[dict]:
    result = []
    for effect in clip.get("timedEffects", []):
        original_start = effect["startUs"]
        original_duration = effect["durationUs"]
        start = max(original_start, offset_us)
        end = min(original_start + original_duration, offset_us + duration_us)
        if end <= start:
            continue
        phase_start = effect.get("progressStart", 0)
        phase_delta = effect.get("progressEnd", 1) - phase_start
        result.append(
            {
                **deepcopy(effect),
                "startUs": start - offset_us,
                "durationUs": end - start,
                "progressStart": phase_start
                + phase_delta * (start - original_start) / original_duration,
                "progressEnd": phase_start
                + phase_delta * (end - original_start) / original_duration,
            }
        )
    return result


def scale_timed_effects(clip: dict, ratio: float, duration_us: int) -> list[dict]:
    result = []
    for effect in clip.get("timedEffects", []):
        start = floor(effect["startUs"] * ratio)
        end = min(duration_us, floor((effect["startUs"] + effect["durationUs"]) * ratio))
        if end > start:
            result.append({**deepcopy(effect), "startUs": start, "durationUs": end - start})
    return result
