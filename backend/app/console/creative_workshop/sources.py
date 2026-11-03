"""Request-bound, path-free source snapshots supplied by the integration owner."""

import hashlib
import io
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class CreativeSource:
    title: str
    summary: str
    manifest: dict
    skill_archive: bytes | None = None
    skill_sha256: str = ""

    def verified_skill(self) -> bytes | None:
        if self.skill_archive is None:
            if self.skill_sha256:
                raise ValueError("Skill 来源摘要无效")
            return None
        if hashlib.sha256(self.skill_archive).hexdigest() != self.skill_sha256:
            raise ValueError("Skill 来源摘要不匹配")
        return self.skill_archive


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
