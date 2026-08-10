from fastapi import APIRouter

from app.routes.galgame_workshop import asr, assets, maintenance, projects, story

router = APIRouter(tags=["galgame-workshop"])
prefix = "/galgame-workshop/projects"
router.include_router(projects.router, prefix=prefix)
router.include_router(story.router, prefix=prefix)
router.include_router(assets.router, prefix=prefix)
router.include_router(asr.router, prefix=prefix)
router.include_router(maintenance.router, prefix=prefix)
