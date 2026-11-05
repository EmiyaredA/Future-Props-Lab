"""Asset-owned authorization-independent preview paths and protocol error mapping."""

from dataclasses import dataclass
from pathlib import Path

from studio.contracts.asset_library.errors import AssetError
from studio.runtime.files.image_sizes import ThumbnailSize
from studio.runtime.files.raster import RasterPreviewError


@dataclass(frozen=True)
class ThumbnailSource:
    id: str
    revision: int
    owner_user_id: str
    media_kind: str
    mime_type: str


async def asset_thumbnail(settings, row, source: Path, size: ThumbnailSize, *, previews) -> Path:
    if row.media_kind != "image" or row.mime_type == "image/svg+xml":
        raise AssetError("此素材暂不支持缩略预览", code="thumbnail_unsupported", status=422)
    target = (
        settings.account_path(row.owner_user_id)
        / "previews"
        / row.id
        / f"{row.revision}-{size}.webp"
    )
    try:
        return await previews.render(source, target, size)
    except RasterPreviewError as exc:
        raise AssetError(str(exc), code=exc.code, status=422) from exc
