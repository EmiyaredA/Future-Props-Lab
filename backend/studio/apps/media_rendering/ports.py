"""Media read capabilities: authorization precedes borrowing and is rechecked before return."""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from studio.contracts.asset_library.media_content import MediaContent
from studio.contracts.media_rendering.image_crop import ImageCropIn


class MediaSources(Protocol):
    def borrow(self, owner: str, asset_id: str) -> AbstractAsyncContextManager[MediaContent]: ...


class MediaProcessor(Protocol):
    async def crop(self, source: MediaContent, body: ImageCropIn) -> bytes: ...

    async def video_info(self, source: MediaContent) -> dict: ...


class MediaAuthorization(Protocol):
    async def ensure_active(self) -> None: ...
