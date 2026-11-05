"""Shared audio seam kinds and their deterministic gain/filter curves."""

from __future__ import annotations

import math

AUDIO_SEAM_KINDS = frozenset(
    {"audio-crossfade", "audio-equal-power", "audio-dip", "audio-filter-sweep"}
)


def eased_progress(progress: float, easing: str) -> float:
    progress = min(1.0, max(0.0, progress))
    if easing == "ease-in":
        return progress * progress
    if easing == "ease-out":
        return 1 - (1 - progress) ** 2
    if easing == "ease-in-out":
        return progress * progress * (3 - 2 * progress)
    return progress


def seam_gain(kind: str, progress: float, *, incoming: bool) -> float:
    progress = min(1.0, max(0.0, progress))
    if kind == "audio-equal-power":
        return math.sin(math.pi * progress / 2) if incoming else math.cos(math.pi * progress / 2)
    if kind == "audio-dip":
        return max(0.0, 2 * progress - 1) if incoming else max(0.0, 1 - 2 * progress)
    return progress if incoming else 1 - progress


def sweep_frequency(progress: float, *, incoming: bool) -> float:
    progress = min(1.0, max(0.0, progress))
    start, end = (3000.0, 30.0) if incoming else (18000.0, 300.0)
    return start * (end / start) ** progress
