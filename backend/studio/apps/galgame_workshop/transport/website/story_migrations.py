from __future__ import annotations

from fastapi import APIRouter

from app.deps import OwnerDep, SessionDep
from studio.apps.galgame_workshop.schemas import (
    GalgameStoryMigrationRunIn,
    GalgameStoryMigrationRunOut,
    GalgameStoryMigrationStatusOut,
)
from studio.apps.galgame_workshop.story.story_migrations import GalgameStoryMigrations

router = APIRouter()


@router.get("/status", response_model=GalgameStoryMigrationStatusOut)
async def get_story_migration_status(
    session: SessionDep, owner_user_id: OwnerDep
) -> GalgameStoryMigrationStatusOut:
    return await GalgameStoryMigrations(session, owner_user_id).status()


@router.post("/run", response_model=GalgameStoryMigrationRunOut)
async def run_story_migrations(
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: GalgameStoryMigrationRunIn,
) -> GalgameStoryMigrationRunOut:
    return await GalgameStoryMigrations(session, owner_user_id).run(body.limit)
