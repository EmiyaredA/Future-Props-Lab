from __future__ import annotations

from pydantic import BaseModel


class ToolFavoriteIn(BaseModel):
    is_favorite: bool


class ToolNavigationItemOut(BaseModel):
    tool_id: str
    is_favorite: bool
    favorite_updated_at: str | None
    last_used_at: str | None
    use_count: int


class ToolNavigationStateOut(BaseModel):
    items: list[ToolNavigationItemOut]
