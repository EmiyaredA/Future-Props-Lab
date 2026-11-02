"""Legacy image-preview adapter; Assets supplies its own authorized file loader."""

from pathlib import Path

from app.capabilities.asset_store.assets import VisualAssets
from app.capabilities.asset_store.image_previews import render_preview
from app.capabilities.asset_store.library import AssetError


async def thumbnail(session, settings, owner_user_id: str, asset_id: str, size: int) -> Path:
    assets = VisualAssets(session, settings, owner_user_id)
    row, source = await assets.content(asset_id)
    if row.media_kind != "image":
        raise AssetError("此素材暂不支持缩略预览", code="thumbnail_unsupported", status=422)
    target = (
        settings.account_path(owner_user_id) / "previews" / row.id / f"{row.revision}-{size}.webp"
    )
    await session.rollback()
    return await render_preview(source, target, size)
