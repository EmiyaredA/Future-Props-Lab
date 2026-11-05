"""Bounded raster resizing from explicitly authorized paths; no ORM or service lifecycle."""

import asyncio
import contextlib
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError


class RasterPreviewError(ValueError):
    def __init__(self, message, *, code="thumbnail_unsupported"):
        super().__init__(message)
        self.code = code


def _render(source: Path, target: Path, size: int):
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = target.with_name(uuid4().hex + ".tmp")
    try:
        with Image.open(source) as image:
            if image.width * image.height > 40_000_000:
                raise RasterPreviewError("图片超过缩略图解码限制", code="thumbnail_too_large")
            image.seek(0)
            image.thumbnail((size, size), Image.Resampling.LANCZOS)
            frame = ImageOps.exif_transpose(image).convert("RGBA")
            frame.save(staged, format="WEBP", quality=76, method=4)
        os.replace(staged, target)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise RasterPreviewError("此素材暂不支持缩略预览") from exc
    finally:
        staged.unlink(missing_ok=True)


class RasterPreviews:
    def __init__(self, capacity=2):
        self.capacity = asyncio.Semaphore(capacity)

    async def render(self, source: Path, target: Path, size: int) -> Path:
        async with self.capacity:
            task = asyncio.create_task(asyncio.to_thread(_render, source, target, size))
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                with contextlib.suppress(Exception):
                    await task
                raise
        return target


_previews = RasterPreviews()


async def derived_thumbnail(source: Path, target: Path, size: int) -> Path:
    """Resize an already authorized file using this process's bounded decoder."""
    return await _previews.render(source, target, size)
