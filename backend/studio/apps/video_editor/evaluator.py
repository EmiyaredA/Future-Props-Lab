"""Compatibility imports for the shared timeline evaluator."""

from studio.apps.media_rendering.local.evaluator import (
    FrameSource,
    TimelineFrameRenderer,
    clip_opacity,
    property_at,
    timeline_duration_us,
    visual_gaps,
)

__all__ = [
    "FrameSource",
    "TimelineFrameRenderer",
    "clip_opacity",
    "property_at",
    "timeline_duration_us",
    "visual_gaps",
]
