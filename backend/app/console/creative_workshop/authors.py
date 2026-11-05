"""Explicit Creative author display port supplied by the application assembly."""

from typing import Protocol


class CreativeAuthors(Protocol):
    async def name(self, *, item_id: str, author_id: str) -> str | None: ...


def authors(session) -> CreativeAuthors:
    value = session.info.get("creative_authors")
    if value is None:
        factory = session.info.get("creative_authors_factory")
        if factory is None:
            raise RuntimeError("创作作者目录尚未连接")
        value = factory(session)
    return value
