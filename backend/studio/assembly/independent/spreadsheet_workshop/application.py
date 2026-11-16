"""Spreadsheet has only its own database, originals and browser release."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from studio.apps.spreadsheet_workshop.schemas import SpreadsheetError
from studio.apps.spreadsheet_workshop.storage.files import Originals
from studio.apps.spreadsheet_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.spreadsheet_workshop.storage.models import MODELS
from studio.apps.spreadsheet_workshop.storage.records import Records
from studio.apps.spreadsheet_workshop.transport.http import router
from studio.apps.spreadsheet_workshop.use_cases import Workbooks
from studio.contracts.gateway.protocol_hash import public_contract
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.http.web import attach_web, load_release
from studio.runtime.lifecycle.locking import service_lock
from studio.runtime.revisions import RevisionConflictError

SERVICE = "spreadsheet"
ROOT = "/apps/spreadsheet-workshop"
PAGES = tuple(
    ROOT + suffix + ending for suffix in ("", "/projects/{project_id}") for ending in ("", "/")
)


def create_app(*, state_root, catalog, public_key, schema_path=None, web_root=None):
    database = Database(SERVICE, state_root, models=MODELS)
    records = Records(database.sessions, Originals(database.root))

    @asynccontextmanager
    async def lifespan(app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                await records.recover()
                app.state.recovered = True
                yield
            finally:
                app.state.recovered = False
                await database.close()

    app = FastAPI(
        title="FPL Spreadsheet", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.spreadsheet_workbooks = Workbooks(records)
    app.state.recovered = False
    app.add_middleware(RequestLimit, prefix="/v1/spreadsheet-workshop/", maximum=21 * 1024 * 1024)
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)

    async def spreadsheet_error(request, exc):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    app.add_exception_handler(SpreadsheetError, spreadsheet_error)
    app.include_router(router, prefix="/v1")
    if schema_path is not None:
        expected = public_contract(json.loads(schema_path.read_text()), SERVICE, catalog)
        if public_contract(app.openapi(), SERVICE, catalog) != expected:
            raise ValueError("表格服务 API 与发布契约不匹配")
    release = None
    if web_root is not None:
        release = load_release(web_root, SERVICE)
        if schema_path is None or release.api_sha256 != expected:
            raise ValueError("表格服务浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        if not app.state.recovered or release is None:
            raise HTTPException(503, "spreadsheet_release_or_storage_unavailable")
        await records.probe()
        return {"status": "ready", "service": SERVICE, "version": release.build_id}

    return app
