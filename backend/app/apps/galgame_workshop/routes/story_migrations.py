from __future__ import annotations

from fastapi import APIRouter

from app.apps.galgame_workshop.schemas import (
    GalgameStoryMigrationRunIn,
    GalgameStoryMigrationRunOut,
    GalgameStoryMigrationStatusOut,
)
from app.apps.galgame_workshop.story.story_migrations import GalgameStoryMigrations
from app.deps import SessionDep, WorkspaceDep

router = APIRouter()


@router.get("/status", response_model=GalgameStoryMigrationStatusOut)
async def get_story_migration_status(
    session: SessionDep, workspace_id: WorkspaceDep
) -> GalgameStoryMigrationStatusOut:
    return await GalgameStoryMigrations(session, workspace_id).status()


@router.post("/run", response_model=GalgameStoryMigrationRunOut)
async def run_story_migrations(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    body: GalgameStoryMigrationRunIn,
) -> GalgameStoryMigrationRunOut:
    return await GalgameStoryMigrations(session, workspace_id).run(body.limit)
