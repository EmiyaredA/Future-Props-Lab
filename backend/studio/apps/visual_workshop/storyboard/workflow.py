"""Storyboard use cases consume an explicit owner-bound record port."""

from typing import Protocol

from .schemas import StoryboardOut, StoryboardUpdate


class StoryboardRecords(Protocol):
    async def get(self, project_id: str) -> StoryboardOut: ...
    async def save(self, project_id: str, body: StoryboardUpdate) -> StoryboardOut: ...


class Storyboards:
    def __init__(self, records: StoryboardRecords):
        self.records = records

    async def get(self, project_id: str) -> StoryboardOut:
        return await self.records.get(project_id)

    async def save(self, project_id: str, body: StoryboardUpdate) -> StoryboardOut:
        return await self.records.save(project_id, body)
