"""Canonical JPEG projection used by tool-free visual acceptance models."""

from io import BytesIO
from pathlib import Path

from PIL import Image


def review_jpeg(original: Path) -> bytes:
    with Image.open(original) as image:
        image.thumbnail((1024, 1024))
        output = BytesIO()
        image.convert("RGB").save(output, format="JPEG", quality=85)
        return output.getvalue()
