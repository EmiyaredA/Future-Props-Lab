from __future__ import annotations

from fastapi import APIRouter

from app.deps import SessionDep, WorkspaceDep
from app.galgame_workshop.story_migrations import GalgameStoryMigrations
from app.schemas.galgame_workshop import (
    GalgameStoryMigrationRunIn,
    GalgameStoryMigrationRunOut,
    GalgameStoryMigrationStatusOut,
)

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
