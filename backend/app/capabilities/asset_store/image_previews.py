"""Owned raster previews use an authorized source and a bounded pure image processor."""

from studio.contracts.asset_library.errors import AssetError
from studio.runtime.files.raster import RasterPreviewError, RasterPreviews

_previews = RasterPreviews(capacity=2)


async def render_preview(source, target, size):
    try:
        return await _previews.render(source, target, size)
    except RasterPreviewError as exc:
        raise AssetError(str(exc), code=exc.code, status=422) from exc
