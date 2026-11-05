"""Legacy file-library adapter for authorized image and document previews."""

from pathlib import Path

from app.capabilities.asset_store.assets import VisualAssets
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.file_previews import PreviewSource, media_thumbnail
from app.capabilities.asset_store.image_thumbnails import (
    ThumbnailSource as ThumbnailSource,
)
from app.capabilities.asset_store.image_thumbnails import (
    _render as _render,
)
from app.capabilities.asset_store.image_thumbnails import (
    asset_thumbnail as asset_thumbnail,
)
from app.capabilities.asset_store.image_thumbnails import (
    derived_thumbnail as derived_thumbnail,
)
from studio.runtime.files.image_sizes import ThumbnailSize as ThumbnailSize


async def thumbnail(
    session, settings, owner_user_id: str, asset_id: str, size: ThumbnailSize, page: int = 1
) -> tuple[Path, str]:
    assets = VisualAssets(session, settings, owner_user_id)
    row, source = await assets.content(asset_id)
    # Capture the authorized resource before ending the short read transaction.
    if row.media_kind != "image":
        info = PreviewSource(
            **{name: getattr(row, name) for name in PreviewSource.__dataclass_fields__}
        )
        await session.rollback()
        return await media_thumbnail(settings, info, source, size, page), "image/webp"
    if page != 1:
        raise AssetError("只有 PDF 支持分页预览", code="preview_page_out_of_range")
    if row.mime_type == "image/svg+xml":
        return source, "image/svg+xml"
    source_info = ThumbnailSource(
        id=row.id,
        revision=row.revision,
        owner_user_id=row.owner_user_id,
        media_kind=row.media_kind,
        mime_type=row.mime_type,
    )
    await session.rollback()
    return await asset_thumbnail(settings, source_info, source, size), "image/webp"
