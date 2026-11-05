"""File-backed borrowed media and bounded staging for interchangeable stream sources."""

import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.media_content import MediaContent, MediaDescription


class FileMediaContent:
    def __init__(self, description: MediaDescription, path: Path):
        self.description = description
        self._path = path
        self._stream = None

    def __enter__(self):
        self._stream = self._path.open("rb")
        return self

    def __exit__(self, *_exc):
        if self._stream is not None:
            self._stream.close()
            self._stream = None

    async def read(self, size=-1):
        if self._stream is None:
            raise RuntimeError("Media lease is closed")
        return self._stream.read(size)


@asynccontextmanager
async def materialized_media(content: MediaContent, *, root: Path, maximum: int):
    """Only I/O adapters see paths. Foreign stream implementations remain supported.

    Reuse an already borrowed file without a second multi-gigabyte copy. A different
    source is staged in the owning process's directory and always removed on exit.
    """
    if isinstance(content, FileMediaContent):
        if content._stream is None:
            raise RuntimeError("Media lease is closed")
        yield content._path
        return
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="media-", dir=root) as directory:
        source = Path(directory) / "source.bin"
        received = 0
        with source.open("xb") as output:
            while chunk := await content.read(1024 * 1024):
                received += len(chunk)
                if received > maximum:
                    raise AssetError("文件超过处理大小限制", code="file_too_large", status=413)
                output.write(chunk)
        yield source
