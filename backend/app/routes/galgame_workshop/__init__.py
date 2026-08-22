from fastapi import APIRouter

from app.routes.galgame_workshop import (
    annotation_import,
    asr,
    assets,
    maintenance,
    projects,
    story,
    story_migrations,
    video_export,
)

router = APIRouter(tags=["galgame-workshop"])
router.include_router(story_migrations.router, prefix="/galgame-workshop/story-migrations")
prefix = "/galgame-workshop/projects"
router.include_router(projects.router, prefix=prefix)
router.include_router(story.router, prefix=prefix)
router.include_router(annotation_import.router, prefix=prefix)
router.include_router(assets.router, prefix=prefix)
router.include_router(asr.router, prefix=prefix)
router.include_router(maintenance.router, prefix=prefix)
router.include_router(video_export.router, prefix=prefix)
