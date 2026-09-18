from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from app.capabilities.media_rendering.timeline_document import VideoEditorTimelineDocument


@dataclass(frozen=True)
class RenderCaptureFrame:
    x: int = 0
    y: int = 0
    width: int = 1920
    height: int = 1080


@dataclass(frozen=True)
class RenderPlan:
    """Immutable input shared by exact-frame and final video rendering."""

    document: VideoEditorTimelineDocument
    asset_paths: dict[str, Path]
    capture_frame: RenderCaptureFrame = RenderCaptureFrame()
    metadata: dict[str, object] = field(default_factory=dict)
