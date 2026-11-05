"""Request-bound, path-free source snapshots supplied by the integration owner."""

import io
from typing import Protocol

from studio.contracts.creative_workshop.creative_source_snapshot import (
    CreativeSource as CreativeSource,
)


class CreativeSources(Protocol):
    async def snapshot(self, *, owner: str, kind: str, source_id: str) -> CreativeSource | None: ...


class MemoryIncoming:
    filename = "source.zip"
    content_type = "application/zip"

    def __init__(self, content: bytes):
        self.content = io.BytesIO(content)

    async def read(self, size: int = -1) -> bytes:
        return self.content.read(size)

    async def close(self) -> None:
        self.content.close()
