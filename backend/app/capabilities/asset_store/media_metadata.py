"""Inspect the bytes of an already scoped, owned media file."""

import hashlib
from pathlib import Path

from PIL import Image
from tinytag import TinyTag, TinyTagException


def inspect_media_file(
    path: Path, media_kind: str
) -> tuple[str, int | None, int | None, int | None]:
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
    elif media_kind in {"audio", "video"}:
        try:
            tag = TinyTag.get(path)
            if tag.duration is not None:
                duration_ms = max(0, round(float(tag.duration) * 1000))
        except (OSError, ValueError, TinyTagException):
            duration_ms = None
    return digest.hexdigest(), width, height, duration_ms
