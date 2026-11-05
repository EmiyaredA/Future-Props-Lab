"""Observe committed versions; clients reload snapshots and never settle turns."""

from dataclasses import dataclass
from typing import Protocol


class TurnVersions(Protocol):
    async def read(self, owner: str, chat_id: str):
        """Return detached versions after closing the storage read scope."""
        ...


@dataclass(frozen=True)
class TurnUpdate:
    kind: str
    version: object = None


class ObserveTurns:
    def __init__(self, versions: TurnVersions, *, authorize, disconnected, pause):
        self.versions, self.authorize = versions, authorize
        self.disconnected, self.pause = disconnected, pause

    async def stream(self, owner: str, chat_id: str):
        previous = None
        while not await self.disconnected():
            if not await self.authorize():
                break
            version = await self.versions.read(owner, chat_id)
            if version != previous:
                previous = version
                yield TurnUpdate("change", version)
            else:
                yield TurnUpdate("heartbeat")
            await self.pause()
        yield TurnUpdate("auth_expired")
