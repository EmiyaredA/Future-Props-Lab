"""Adapt a borrowed stream to bounded local processors without exposing host paths to use cases."""

from studio.runtime.files.borrowed_media import materialized_media


class LocalMediaProcessor:
    def __init__(self, previews, *, root, maximum):
        self.previews, self.root, self.maximum = previews, root, maximum

    async def crop(self, source, body):
        async with self.previews.capacity:
            async with materialized_media(source, root=self.root, maximum=self.maximum) as path:
                return await self.previews.crop(source.description, path, body)

    async def video_info(self, source):
        async with self.previews.capacity:
            async with materialized_media(source, root=self.root, maximum=self.maximum) as path:
                return await self.previews.video_info(source.description, path)
