"""Explicit local Skill archive parser supplied by the owning application."""

from typing import Protocol


class CreativeArchives(Protocol):
    async def stage(self, owner: str, upload): ...
