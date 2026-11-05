"""Bounded, account-private derived previews. Originals stay authoritative."""

import asyncio
import contextlib
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from app.capabilities.asset_store.errors import AssetError
from studio.runtime.files.image_sizes import ThumbnailSize

_capacity = asyncio.Semaphore(2)


@dataclass(frozen=True)
class ThumbnailSource:
    id: str
    revision: int
    owner_user_id: str
    media_kind: str
    mime_type: str


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
            frame = ImageOps.exif_transpose(image)
            frame.thumbnail((size, size), Image.Resampling.LANCZOS)
            frame = frame.convert("RGBA")
            frame.save(staged, format="WEBP", quality=76, method=4)
        os.replace(staged, target)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise AssetError(
            "此素材暂不支持缩略预览", code="thumbnail_unsupported", status=422
        ) from exc
    finally:
        staged.unlink(missing_ok=True)


async def derived_thumbnail(source: Path, target: Path, size: ThumbnailSize) -> Path:
    """Render only an already authorized source; callers own access and versioning."""
    async with _capacity:
        task = asyncio.create_task(asyncio.to_thread(_render, source, target, size))
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            # Keep the slot until the decoding thread actually finishes.
            with contextlib.suppress(Exception):
                await task
            raise
    return target


async def asset_thumbnail(settings, row, source: Path, size: ThumbnailSize) -> Path:
    if row.media_kind != "image" or row.mime_type == "image/svg+xml":
        raise AssetError("此素材暂不支持缩略预览", code="thumbnail_unsupported", status=422)
    target = (
        settings.account_path(row.owner_user_id)
        / "previews"
        / row.id
        / f"{row.revision}-{size}.webp"
    )
    return await derived_thumbnail(source, target, size)
