from fastapi import APIRouter

from studio.apps.presentation_workshop.transport.website.exchange import router as imports
from studio.apps.presentation_workshop.transport.website.exports import router as exports
from studio.apps.presentation_workshop.transport.website.projects import router as projects
from studio.apps.presentation_workshop.transport.website.templates import router as templates

router = APIRouter(prefix="/presentation-workshop", tags=["presentation-workshop"])
for component in (imports, templates, projects, exports):
    router.include_router(component)
