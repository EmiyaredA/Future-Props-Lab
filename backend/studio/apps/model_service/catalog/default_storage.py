"""Account default selections participate in the owning catalog transaction."""

from typing import Protocol


class CatalogDefaults(Protocol):
    async def read(self, *, owner_user_id: str) -> dict[str, str]: ...

    async def replace(self, *, owner_user_id: str, model_ids: dict[str, str]) -> None: ...
