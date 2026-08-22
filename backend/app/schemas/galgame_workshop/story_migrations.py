from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.galgame_workshop.base_core import GalgameStoryModel


class GalgameStoryMigrationStatusOut(BaseModel):
    pending: int
    invalid: int
    current: int
    total: int


class GalgameStoryMigrationRunIn(GalgameStoryModel):
    limit: int = Field(default=100, ge=1, le=100)


class GalgameStoryMigrationRunOut(BaseModel):
    migrated: int
    conflicts: int
    invalid: int
    remaining: int
    current: int
    total: int
