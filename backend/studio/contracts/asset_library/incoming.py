from __future__ import annotations

from typing import Protocol


class IncomingFile(Protocol):
    """Single-consumer input stream, independent of HTTP and storage implementations.

    The receiving I/O adapter owns closing the stream on success, error and cancellation.
    Names and MIME types are untrusted hints: the owner validates bytes and account scope
    before publishing a stored resource. A read failure never implies a committed upload.
    """

    @property
    def filename(self) -> str | None: ...

    @property
    def content_type(self) -> str | None: ...

    async def read(self, size: int = -1) -> bytes: ...

    async def close(self) -> None: ...
