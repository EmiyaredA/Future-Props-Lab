"""Standalone Motion project and document operations."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from app.apps.motion_compositor.models import MotionDocument, MotionOperationBatch, MotionProject
from app.apps.motion_compositor.routes.projects import router
from app.deps import db_session, require_studio_auth
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.database import Database
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.motion_assets import SOURCE
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.routing import RouteCatalog

from .file_routes import router as file_router
from .migrations.registry import MIGRATIONS
from .resources import ProjectResources

SERVICE = "motion"
PROJECTS = SOURCE + "/projects"
PROJECT = PROJECTS + "/{project_id}"
OPERATIONS = {
    ("GET", PROJECTS),
    ("POST", PROJECTS),
    ("GET", PROJECT),
    ("PATCH", PROJECT),
    ("GET", PROJECT + "/document"),
    ("GET", SOURCE + "/import-sources"),
    ("GET", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets/import"),
    ("GET", PROJECT + "/assets/{asset_id}/file"),
    ("POST", PROJECT + "/document/operations"),
}


def create_app(*, state_root, catalog, public_key, credential, schema_path=None, transport=None):
    database = Database(
        SERVICE, state_root, models=(MotionProject, MotionDocument, MotionOperationBatch)
    )
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                yield
            finally:
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Motion", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.motion_capabilities = capabilities

    async def request_session(connection: HTTPConnection):
        async with database.sessions() as session:
            session.info["motion_project_resources"] = lambda db, _owner: ProjectResources(
                connection, db, capabilities
            )
            yield session

    app.dependency_overrides[db_session] = request_session
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    for component in (router, file_router):
        app.include_router(
            component,
            prefix=SOURCE,
            tags=["motion-compositor"],
            dependencies=[Depends(require_studio_auth)],
        )
    if schema_path is not None:
        partial = RouteCatalog(
            operation
            for operation in catalog.operations
            if operation.service == SERVICE and (operation.method, operation.path) in OPERATIONS
        )
        schema = app.openapi()
        mounted = {
            (method.upper(), path)
            for path, operations in schema["paths"].items()
            if path.startswith("/v1/")
            for method in operations
        }
        if (
            mounted != OPERATIONS
            or {(operation.method, operation.path) for operation in partial.operations}
            != OPERATIONS
            or public_contract(schema, SERVICE, partial)
            != public_contract(json.loads(schema_path.read_text()), SERVICE, partial)
        ):
            raise ValueError("特效文稿 API 与发布契约不匹配")

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "motion_cutover_incomplete")

    return app
