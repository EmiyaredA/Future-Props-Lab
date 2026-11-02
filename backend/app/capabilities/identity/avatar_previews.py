"""Account-private bounded avatars never import file-library state or media jobs."""

from app.runtime.raster import RasterPreviews

_previews = RasterPreviews(capacity=1)


async def avatar_thumbnail(source, target, size):
    return await _previews.render(source, target, size)
