"""Catalog writes require explicit task occupancy from the owning runtime."""

from typing import Protocol


class CatalogTaskUsage(Protocol):
    async def model_active(self, *, owner_user_id: str, model_id: str) -> bool: ...

    async def provider_active(self, *, owner_user_id: str, provider_id: str) -> bool: ...
