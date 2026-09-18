from __future__ import annotations

from typing import Protocol


class IncomingFile(Protocol):
    """HTTP-independent shape consumed by file-oriented business use cases."""

    @property
    def filename(self) -> str | None: ...

    @property
    def content_type(self) -> str | None: ...

    async def read(self, size: int = -1) -> bytes: ...

    async def close(self) -> None: ...
