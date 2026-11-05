"""Account-owned idle policy; callers establish current desktop authorization."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class IdleSnapshot:
    idle_minutes: int = 30
    revision: int = 0


class PreferenceConflict(Exception):
    def __init__(self, current: IdleSnapshot):
        super().__init__("锁定时限已变更")
        self.current = current


class PreferenceStore(Protocol):
    async def read(self, *, owner: str) -> IdleSnapshot: ...

    async def compare_and_set(
        self, *, owner: str, minutes: int, expected_revision: int
    ) -> IdleSnapshot:
        """Commit a complete owner-scoped update or raise a detached conflict.

        Missing records have revision zero. Concurrent creates/updates serialize;
        exceptions and cancellation roll back. Unknown commits are resolved by
        reading a snapshot, never by blindly retrying with a new revision.
        """
        ...


class DesktopPreferences:
    def __init__(self, store: PreferenceStore):
        self.store = store

    async def read(self, *, owner: str) -> IdleSnapshot:
        return await self.store.read(owner=owner)

    async def save(self, *, owner: str, minutes: int, revision: int) -> IdleSnapshot:
        if type(minutes) is not int or not 5 <= minutes <= 120:
            raise ValueError("桌面空闲时限必须为 5 到 120 分钟")
        if type(revision) is not int or revision < 0:
            raise ValueError("桌面偏好版本无效")
        return await self.store.compare_and_set(
            owner=owner, minutes=minutes, expected_revision=revision
        )
