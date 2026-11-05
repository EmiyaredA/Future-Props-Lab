"""Read access is rechecked for the authenticated owner on every link request."""

from typing import Protocol


class ResourceReader(Protocol):
    async def exists(self, owner: str, kind: str, resource_id: str) -> bool:
        """Return false for absent, deleted or foreign resources; do not cache authorization."""
        ...
