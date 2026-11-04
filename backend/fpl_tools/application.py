"""Independent Tools owner for account favorites and recent usage."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.deps import require_studio_auth
from app.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.tool_navigation.models import ToolNavigationItem
from app.tool_navigation.routes import router
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check

from .migrations.registry import MIGRATIONS


def create_app(*, state_root, catalog, public_key):
    database = Database("tools", state_root, models=(ToolNavigationItem,))

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "tools", MIGRATIONS)
                yield
            finally:
                await database.close()

    app = FastAPI(
        title="FPL Tools", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.add_middleware(SignedIdentity, service="tools", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.include_router(router, prefix="/v1", dependencies=[Depends(require_studio_auth)])

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "tools"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "tool_host_lane_incomplete")

    return app
