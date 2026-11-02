"""Only bounded private previews run here; heavy media jobs belong to Rendering."""

from app.capabilities.asset_store.image_previews import render_preview
from app.capabilities.asset_store.library import AssetError


async def thumbnail(files, asset_id, size):
    row, source = await files.content(asset_id)
    if row.media_kind != "image":
        raise AssetError("此素材暂不支持缩略预览", code="thumbnail_unsupported", status=422)
    target = (
        files.settings.account_path(files.owner_user_id)
        / "previews"
        / row.id
        / f"{row.revision}-{size}.webp"
    )
    await files.session.rollback()
    return await render_preview(source, target, size)
