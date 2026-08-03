from fastapi import APIRouter, Depends

from app.deps import require_studio_auth
from app.routes.models import call_logs, catalog, model_test
from app.routes.system import router as system_router
from app.routes.tool_navigation import router as tool_navigation_router

api_router = APIRouter(prefix="/v1")
api_router.include_router(system_router)
api_router.include_router(catalog.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(call_logs.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(model_test.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(tool_navigation_router, dependencies=[Depends(require_studio_auth)])
