"""Read-only catalogue values required by transcription policy; no ORM registration."""

from typing import Protocol


class TranscriptionModel(Protocol):
    slug: str
    capabilities: list[str]
    categories: list[str]
    enabled: bool


class TranscriptionProvider(Protocol):
    kind: str
    enabled: bool
