"""Published account-wide Story format checks and upgrade operations."""

from fastapi import APIRouter

from app.apps.galgame_workshop.schemas import (
    GalgameStoryMigrationRunIn,
    GalgameStoryMigrationRunOut,
    GalgameStoryMigrationStatusOut,
)
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .story_migration import StoryMigrations

router = APIRouter(prefix="/v1/galgame-workshop/story-migrations", tags=["galgame-workshop"])


@router.get("/status", response_model=GalgameStoryMigrationStatusOut)
async def get_story_migration_status(
    session: SessionDep, owner_user_id: OwnerDep
) -> GalgameStoryMigrationStatusOut:
    return await StoryMigrations(session, owner_user_id).status()


@router.post("/run", response_model=GalgameStoryMigrationRunOut)
async def run_story_migrations(
    session: SessionDep, owner_user_id: OwnerDep, body: GalgameStoryMigrationRunIn
) -> GalgameStoryMigrationRunOut:
    migrations = StoryMigrations(session, owner_user_id)
    return await migrations.run(body.limit, verify_projection=migrations.verify_projection)
