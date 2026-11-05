"""Account-owned favorites and usage; the browser registry owns tool definitions."""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Protocol

from studio.contracts.tools.navigation import ToolNavigationItemOut, ToolNavigationStateOut


class NavigationStore(Protocol):
    """Return committed snapshots, never ORM or mutable repository state.

    The authenticated account is explicit and scopes every operation. Each write
    is atomic, including first creation, and preserves the other navigation fields.
    Cancellation before commit rolls back. Usage is additive per accepted call;
    an unknown commit result must not trigger an automatic retry. There is no
    request-id receipt in this existing API, and it cannot promise exactly-once use.
    """

    async def list(self, *, owner: str) -> ToolNavigationStateOut: ...

    async def set_favorite(
        self, *, owner: str, tool_id: str, is_favorite: bool, at: datetime
    ) -> ToolNavigationItemOut: ...

    async def record_use(
        self, *, owner: str, tool_id: str, at: datetime
    ) -> ToolNavigationItemOut: ...


class ToolNavigation:
    def __init__(self, store: NavigationStore, *, clock: Callable[[], datetime]):
        self.store, self.clock = store, clock

    @staticmethod
    def _validate(owner, tool_id=None):
        if not owner or not owner.strip():
            raise ValueError("Navigation requires an authenticated account")
        if tool_id is not None and not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?", tool_id
        ):
            raise ValueError("Invalid tool identifier")

    async def list(self, *, owner: str) -> ToolNavigationStateOut:
        self._validate(owner)
        return await self.store.list(owner=owner)

    async def set_favorite(self, *, owner: str, tool_id: str, is_favorite: bool):
        self._validate(owner, tool_id)
        return await self.store.set_favorite(
            owner=owner, tool_id=tool_id, is_favorite=is_favorite, at=self.clock()
        )

    async def record_use(self, *, owner: str, tool_id: str):
        self._validate(owner, tool_id)
        return await self.store.record_use(owner=owner, tool_id=tool_id, at=self.clock())
