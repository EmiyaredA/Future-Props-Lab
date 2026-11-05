from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol


class RollbackSession(Protocol):
    async def rollback(self) -> None: ...


class RevisionWriteResult(Protocol):
    rowcount: int


class RevisionSnapshot(Protocol):
    revision: int

    def model_dump(self, *, mode: str) -> dict: ...


class RevisionConflictError(Exception):
    def __init__(self, expected: int, current: int, snapshot: dict) -> None:
        super().__init__(f"catalog revision conflict: expected {expected}, current {current}")
        self.expected = expected
        self.current = current
        self.snapshot = snapshot


async def require_revision_write(
    session: RollbackSession,
    result: RevisionWriteResult,
    *,
    expected: int,
    load_current: Callable[[], Awaitable[RevisionSnapshot]],
) -> None:
    """Require one CAS write and include the current snapshot on conflict."""
    if result.rowcount == 1:
        return
    await session.rollback()
    current = await load_current()
    raise RevisionConflictError(
        expected,
        current.revision,
        current.model_dump(mode="json"),
    )
