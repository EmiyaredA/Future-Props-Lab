"""Bounded raster previews; callers supply an already authorized source path."""

import asyncio
import contextlib
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from app.capabilities.asset_store.library import AssetError

_capacity = asyncio.Semaphore(2)


def _render(source: Path, target: Path, size: int) -> None:
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = target.with_name(uuid4().hex + ".tmp")
    try:
        with Image.open(source) as image:
            if image.width * image.height > 40_000_000:
                raise AssetError("图片超过缩略图解码限制", code="thumbnail_too_large", status=422)
            image.seek(0)
            image.thumbnail((size, size))
            frame = ImageOps.exif_transpose(image).convert("RGBA")
            frame.save(staged, format="WEBP", quality=76, method=4)
        os.replace(staged, target)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise AssetError(
            "此素材暂不支持缩略预览", code="thumbnail_unsupported", status=422
        ) from exc
    finally:
        staged.unlink(missing_ok=True)


async def render_preview(source: Path, target: Path, size: int) -> Path:
    async with _capacity:
        task = asyncio.create_task(asyncio.to_thread(_render, source, target, size))
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            # Keep the bounded slot until Pillow actually finishes its thread.
            with contextlib.suppress(Exception):
                await task
            raise
    return target
