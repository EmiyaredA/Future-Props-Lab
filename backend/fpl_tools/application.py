"""Independent Tools owner for account favorites and recent usage."""

import json
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
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.web import attach_web, load_release

from .migrations.registry import MIGRATIONS

PAGES = ("/tools", "/tools/video-frame-exporter", "/tools/video-downloader")


def create_app(*, state_root, catalog, public_key, web_root=None, schema_path=None):
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
    if web_root is not None:
        if schema_path is None:
            raise ValueError("Tools 浏览器程序缺少发布契约")
        release = load_release(web_root, "tools")
        published = json.loads(schema_path.read_text())
        if release.api_sha256 != public_contract(published, "tools", catalog):
            raise ValueError("Tools 浏览器程序与发布契约不匹配")
        pages = [path for page in PAGES for path in (page, page + "/")]
        attach_web(app, release, pages=pages)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "tools"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "tool_host_lane_incomplete")

    return app
