"""Crop an authorized library image without modifying its source or creating an asset."""

import asyncio
import io

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings


async def crop_image(session, workspace_id, asset_id, body):
    asset = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id,
            VisualAsset.workspace_id == workspace_id,
        )
    )
    if asset is None:
        raise AssetError("图片不存在", code="not_found", status=404)
    if asset.media_kind != "image" or asset.mime_type == "image/svg+xml":
        raise AssetError("裁剪需要栅格图片；SVG 请先通过预览接口转换")
    source = AssetStorage(get_settings()).path_for(asset)
    await session.rollback()

    def render():
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original)
            if body.x + body.width > image.width or body.y + body.height > image.height:
                raise AssetError("裁剪范围超出图片边界")
            with image.crop((body.x, body.y, body.x + body.width, body.y + body.height)) as cropped:
                target = io.BytesIO()
                cropped.convert("RGBA").save(target, format="PNG")
                return target.getvalue()

    try:
        return await asyncio.to_thread(render)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise AssetError("图片无法解码或超过安全解码上限") from exc
