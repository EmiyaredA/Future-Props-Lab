from fastapi import APIRouter

from .exchange import router as imports
from .exports import router as exports
from .projects import router as projects
from .templates import router as templates

router = APIRouter(prefix="/presentation-workshop", tags=["presentation-workshop"])
for component in (imports, templates, projects, exports):
    router.include_router(component)
