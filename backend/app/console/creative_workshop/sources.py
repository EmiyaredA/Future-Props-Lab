"""Request-bound, path-free source snapshots supplied by the integration owner."""

import io
from typing import Protocol

from fpl_runtime.creative_source_snapshot import CreativeSource as CreativeSource


class CreativeSources(Protocol):
    async def snapshot(self, *, owner: str, kind: str, source_id: str) -> CreativeSource | None: ...


def sources(session) -> CreativeSources:
    value = session.info.get("creative_sources")
    if value is None:
        factory = session.info.get("creative_sources_factory")
        if factory is None:
            raise RuntimeError("创作来源服务尚未连接")
        value = factory(session)
    return value


class MemoryIncoming:
    filename = "source.zip"
    content_type = "application/zip"

    def __init__(self, content: bytes):
        self.content = io.BytesIO(content)

    async def read(self, size: int = -1) -> bytes:
        return self.content.read(size)

    async def close(self) -> None:
        self.content.close()
