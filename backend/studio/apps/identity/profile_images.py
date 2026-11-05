"""Account-private bounded avatars never import file-library state or media jobs."""

from studio.runtime.files.raster import RasterPreviews

_previews = RasterPreviews(capacity=1)


async def avatar_thumbnail(source, target, size):
    return await _previews.render(source, target, size)
