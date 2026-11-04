"""Standalone Presentation with request-bound Assets and its own project store."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from app.apps.presentation_workshop.project_errors import PresentationError
from app.apps.presentation_workshop.routes.projects import router
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
from fpl_runtime.presentation_assets import PROJECTS
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime, reference_lifespan
from fpl_runtime.routing import RouteCatalog

from .assets import ProjectAssets, ProjectReferences
from .migrations.registry import MIGRATIONS
from .models import MODELS, PresentationReferenceMutation

SERVICE = "presentation"
PROJECT = PROJECTS + "/{project_id}"
OPERATIONS = {
    ("GET", PROJECTS),
    ("POST", PROJECTS),
    ("GET", PROJECT),
    ("PUT", PROJECT),
    ("DELETE", PROJECT),
    ("POST", PROJECT + "/operations"),
}


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    credential,
    schema_path=None,
    transport=None,
    run_worker=True,
):
    database = Database(SERVICE, state_root, models=MODELS)
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    @asynccontextmanager
    async def lifespan(app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                async with reference_lifespan(app):
                    yield
            finally:
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Presentation", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    install_reference_runtime(
        app,
        service=SERVICE,
        model=PresentationReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )

    async def request_session(connection: HTTPConnection):
        async with database.sessions() as session:
            session.info.update(
                presentation_project_assets=lambda _db, _owner: ProjectAssets(
                    connection, capabilities
                ),
                presentation_retention=ProjectReferences(
                    connection, session, app.state.reference_mutations
                ),
            )
            yield session

    async def presentation_error(request, exc):
        return await http_exception_handler(
            request, HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
        )

    app.dependency_overrides[db_session] = request_session
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_exception_handler(PresentationError, presentation_error)
    app.include_router(
        router,
        prefix="/v1/presentation-workshop",
        tags=["presentation-workshop"],
        dependencies=[Depends(require_studio_auth)],
    )
    if schema_path is not None:
        project_catalog = RouteCatalog(
            item
            for item in catalog.operations
            if item.service == SERVICE and (item.method, item.path) in OPERATIONS
        )
        schema = app.openapi()
        mounted = {
            (method.upper(), path)
            for path, methods in schema["paths"].items()
            if path.startswith("/v1/")
            for method in methods
        }
        if (
            mounted != OPERATIONS
            or {(item.method, item.path) for item in project_catalog.operations} != OPERATIONS
        ):
            raise ValueError("演示文稿项目路由归属不匹配")
        expected = public_contract(json.loads(schema_path.read_text()), SERVICE, project_catalog)
        if public_contract(schema, SERVICE, project_catalog) != expected:
            raise ValueError("演示文稿项目 API 与发布契约不匹配")

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "presentation_cutover_incomplete")

    return app
