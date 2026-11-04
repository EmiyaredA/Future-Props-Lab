"""Standalone Video Editor uses only its own database and public contracts."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.apps.video_editor.models import VideoEditorProject, VideoEditorTimeline
from app.apps.video_editor.routes.projects import router
from app.deps import db_session, require_studio_auth
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
from fpl_runtime.routing import RouteCatalog

from .migrations.registry import MIGRATIONS

SERVICE = "video"
SOURCE = "/v1/video-editor"
PROJECTS = SOURCE + "/projects"
PROJECT = PROJECTS + "/{project_id}"
OPERATIONS = {
    ("GET", PROJECTS),
    ("POST", PROJECTS),
    ("GET", PROJECT),
    ("PATCH", PROJECT),
    ("GET", PROJECT + "/timeline"),
}


class ProjectLayouts:
    def __init__(self, session, _owner):
        self.session = session

    @asynccontextmanager
    async def create_layout(self, _project_id):
        # Assets owns any future media layout. An empty project needs only its timeline.
        try:
            yield
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            raise


def create_app(*, state_root, catalog, public_key, schema_path):
    database = Database(SERVICE, state_root, models=(VideoEditorProject, VideoEditorTimeline))

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            check(database.path, SERVICE, MIGRATIONS)
            try:
                yield
            finally:
                await database.close()

    app = FastAPI(
        title="FPL Video Editor", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database

    async def request_session():
        async with database.sessions(info={"video_project_layouts": ProjectLayouts}) as session:
            yield session

    app.dependency_overrides[db_session] = request_session
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.include_router(
        router,
        prefix=SOURCE,
        tags=["video-editor"],
        dependencies=[Depends(require_studio_auth)],
    )

    expected = RouteCatalog(
        operation
        for operation in catalog.operations
        if operation.service == SERVICE and (operation.method, operation.path) in OPERATIONS
    )
    schema = app.openapi()
    mounted = {
        (method.upper(), path) for path, methods in schema["paths"].items() for method in methods
    }
    if (
        mounted != OPERATIONS
        or {(operation.method, operation.path) for operation in expected.operations} != OPERATIONS
        or public_contract(schema, SERVICE, expected)
        != public_contract(json.loads(schema_path.read_text()), SERVICE, expected)
    ):
        raise ValueError("视频剪辑项目接口与发布契约不匹配")

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "video_cutover_incomplete")

    return app
