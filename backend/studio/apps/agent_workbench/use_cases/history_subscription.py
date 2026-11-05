"""Observe owned changes with explicit cursor reset and authorization semantics."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Change:
    sequence: int
    kind: str
    session_id: str | None


@dataclass(frozen=True)
class ChangePage:
    latest: int
    items: tuple[Change, ...]


class Changes(Protocol):
    async def read(self, owner: str, after: int, session_id: str | None) -> ChangePage | None:
        """Read at most 201 events, releasing storage before returning snapshots.

        None means the selected conversation no longer exists or is inaccessible.
        IDs and cursor are scoped to the authenticated owner, never supplied owners.
        """
        ...


def selected_changes(page: ChangePage, after: int, session_id=None) -> tuple[Change, ...]:
    if after > page.latest or len(page.items) > 200:
        return (Change(page.latest, "reset", session_id),)
    return page.items


@dataclass(frozen=True)
class HistoryEvent:
    kind: str
    change: Change | None = None


class HistorySubscription:
    def __init__(self, changes: Changes, *, authorize, disconnected, pause):
        self.changes, self.authorize = changes, authorize
        self.disconnected, self.pause = disconnected, pause

    async def stream(self, owner: str, after: int, session_id: str | None = None):
        yield HistoryEvent("connected")
        while not await self.disconnected():
            if not await self.authorize():
                yield HistoryEvent("auth_expired")
                return
            page = await self.changes.read(owner, after, session_id)
            if page is None:
                return
            events = selected_changes(page, after, session_id)
            for event in events:
                after = event.sequence
                yield HistoryEvent("change", event)
            if not events:
                yield HistoryEvent("heartbeat")
            await self.pause()
