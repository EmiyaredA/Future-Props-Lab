"""Explicit local Skill archive parser supplied by the owning application."""

from typing import Protocol


class CreativeArchives(Protocol):
    async def stage(self, owner: str, upload): ...


def archives(session) -> CreativeArchives:
    value = session.info.get("creative_archives")
    if value is None:
        factory = session.info.get("creative_archives_factory")
        if factory is None:
            raise RuntimeError("创作 Skill 解析尚未连接")
        value = factory(session)
    return value
