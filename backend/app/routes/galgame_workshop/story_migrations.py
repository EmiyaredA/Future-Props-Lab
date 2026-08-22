from __future__ import annotations

from fastapi import APIRouter

from app.deps import SessionDep
from app.galgame_workshop.story_migrations import GalgameStoryMigrations
from app.schemas.galgame_workshop import (
    GalgameStoryMigrationRunIn,
    GalgameStoryMigrationRunOut,
    GalgameStoryMigrationStatusOut,
)

router = APIRouter()


@router.get("/status", response_model=GalgameStoryMigrationStatusOut)
async def get_story_migration_status(session: SessionDep) -> GalgameStoryMigrationStatusOut:
    return await GalgameStoryMigrations(session).status()


@router.post("/run", response_model=GalgameStoryMigrationRunOut)
async def run_story_migrations(
    session: SessionDep,
    body: GalgameStoryMigrationRunIn,
) -> GalgameStoryMigrationRunOut:
    return await GalgameStoryMigrations(session).run(body.limit)
