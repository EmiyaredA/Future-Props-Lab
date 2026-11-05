"""Explicit Creative author display port supplied by the application assembly."""

from typing import Protocol


class CreativeAuthors(Protocol):
    async def name(self, *, item_id: str, author_id: str) -> str | None: ...
