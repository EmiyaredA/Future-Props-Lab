"""The published Director API using only its own database and filesystem."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.apps.director_desk.agent_session import DirectorEditorSessions
from app.apps.director_desk.models import DirectorDeskProject, DirectorDeskUserMotion
from app.apps.director_desk.routes import router
from app.deps import require_studio_auth
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.web import attach_web, load_release

from .migrations.registry import MIGRATIONS
from .storage import DirectorStorage

PAGES = (
    "/apps/director-desk",
    "/apps/director-desk/",
    "/apps/director-desk/projects/{project_id}",
    "/apps/director-desk/projects/{project_id}/",
)


def create_app(*, state_root, catalog, public_key, schema_path=None, web_root=None):
    database = Database(
        "director", state_root, models=(DirectorDeskProject, DirectorDeskUserMotion)
    )
    storage = DirectorStorage(database.root)

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, "director", MIGRATIONS)
                await storage.recover(database.sessions)
                yield
            finally:
                await database.close()

    app = FastAPI(
        title="FPL Director", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.director_storage = storage
    app.state.director_editor = DirectorEditorSessions(database.sessions)
    app.add_middleware(SignedIdentity, service="director", public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.include_router(router, prefix="/v1", dependencies=[Depends(require_studio_auth)])
    if schema_path is not None:
        published = json.loads(schema_path.read_text())
        expected = public_contract(published, "director", catalog)
        if public_contract(app.openapi(), "director", catalog) != expected:
            raise ValueError("导演台公开接口与发布契约不匹配")
    if web_root is not None:
        release = load_release(web_root, "director")
        if schema_path is None or release.api_sha256 != expected:
            raise ValueError("导演台浏览器程序与发布契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "director"}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "director_cutover_incomplete")

    return app
