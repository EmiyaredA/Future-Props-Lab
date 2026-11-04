"""Legacy file inspection from its owned filesystem adapter."""

import hashlib
from pathlib import Path

from PIL import Image

try:
    from tinytag import TinyTag
except ImportError:  # pragma: no cover - dependency is required in production
    TinyTag = None  # type: ignore[assignment]


def _file_metadata(path: Path, media_kind: str) -> tuple[str, int | None, int | None, int | None]:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    if media_kind == "image":
        try:
            with Image.open(path) as image:
                width, height = image.size
        except (OSError, SyntaxError, ValueError):
            # Files uploaded by older versions were validated by signature only.
            # Keep them usable while reporting missing dimensions for maintenance.
            width = height = None
    elif media_kind in {"audio", "video"} and TinyTag is not None:
        try:
            tag = TinyTag.get(path)
            if tag.duration is not None:
                duration_ms = max(0, round(float(tag.duration) * 1000))
        except (OSError, ValueError):
            duration_ms = None
    return digest.hexdigest(), width, height, duration_ms
