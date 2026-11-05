"""Media read capabilities: authorization precedes borrowing and is rechecked before return."""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from studio.contracts.asset_library.files import FilePreviewOut
from studio.contracts.asset_library.media_content import MediaContent
from studio.contracts.media_rendering.image_crop import ImageCropIn
from studio.contracts.media_rendering.output import MediaOutput
from studio.contracts.media_rendering.video_frames import VideoFramesIn


class MediaSources(Protocol):
    def borrow(self, owner: str, asset_id: str) -> AbstractAsyncContextManager[MediaContent]: ...


class MediaProcessor(Protocol):
    async def crop(self, source: MediaContent, body: ImageCropIn) -> bytes: ...

    async def video_info(self, source: MediaContent) -> dict: ...

    async def metadata(self, source: MediaContent) -> FilePreviewOut: ...

    async def thumbnail(self, source: MediaContent, size: int, page: int) -> MediaOutput: ...

    async def frames(self, source: MediaContent, body: VideoFramesIn) -> MediaOutput: ...


class MediaAuthorization(Protocol):
    async def ensure_active(self) -> None: ...
