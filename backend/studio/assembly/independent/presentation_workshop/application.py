"""Standalone Presentation with request-bound Assets and its own project store."""

import json
import shutil
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from studio.apps.presentation_workshop.archive_transport import ArchiveTransport
from studio.apps.presentation_workshop.assets import ProjectAssets, ProjectReferences
from studio.apps.presentation_workshop.imports import ImportDelivery, Imports
from studio.apps.presentation_workshop.project_errors import PresentationError
from studio.apps.presentation_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.presentation_workshop.storage.service_models import (
    MODELS,
    PresentationReferenceMutation,
)
from studio.apps.presentation_workshop.transport.website.exchange import router as exchange_router
from studio.apps.presentation_workshop.transport.website.exports import router as exports_router
from studio.apps.presentation_workshop.transport.website.projects import router as projects_router
from studio.apps.presentation_workshop.transport.website.templates import router as templates_router
from studio.assembly.http_dependencies import db_session, require_studio_auth
from studio.assembly.independent.asset_references import (
    install_reference_runtime,
    reference_lifespan,
)
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.presentation_workshop.presentation_assets import (
    BUNDLE,
    LIBRARY,
    PROJECTS,
    SOURCE,
)
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.web import attach_web, load_release
from studio.runtime.lifecycle.locking import service_lock
from studio.runtime.revisions import RevisionConflictError

SERVICE = "presentation"
WEB_ROOT = "/apps/presentation-workshop"
PAGES = tuple(
    WEB_ROOT + suffix + trailing
    for suffix in ("", "/templates", "/templates/{template_id}", "/projects/{project_id}")
    for trailing in ("", "/")
)

PROJECT = PROJECTS + "/{project_id}"
OPERATIONS = {
    ("GET", PROJECTS),
    ("POST", PROJECTS),
    ("GET", PROJECT),
    ("PUT", PROJECT),
    ("DELETE", PROJECT),
    ("POST", PROJECT + "/operations"),
    ("POST", PROJECT + "/template/preview"),
    ("POST", PROJECT + "/template/apply"),
    ("POST", PROJECT + "/export"),
    ("POST", PROJECT + "/export/preview"),
    ("POST", PROJECT + "/export/{format}"),
    ("POST", BUNDLE),
    ("POST", SOURCE + "/imports"),
    ("POST", SOURCE + "/imports/preview"),
}
for kind, prefix in LIBRARY.items():
    resource = f"{prefix}/{{{kind}_id}}"
    OPERATIONS.update(
        {
            ("GET", prefix),
            ("POST", prefix),
            ("GET", resource),
            ("PUT", resource),
            ("DELETE", resource),
            ("POST", resource + "/documents"),
        }
    )


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    credential,
    schema_path=None,
    web_root=None,
    transport=None,
    run_worker=True,
    archive_key=None,
):
    database = Database(SERVICE, state_root, models=MODELS)
    staging = database.root / ".staging"
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    archive = ArchiveTransport(capabilities, archive_key) if archive_key is not None else None
    imports = ImportDelivery(database.sessions, archive) if archive is not None else None

    @asynccontextmanager
    async def lifespan(app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                if staging.is_symlink():
                    raise ValueError("演示工坊暂存目录不能是符号链接")
                staging.mkdir(exist_ok=True, mode=0o700)
                for path in staging.iterdir():
                    if (
                        path.is_dir()
                        and not path.is_symlink()
                        and path.name.startswith(("sources-", "fpl-presentation-"))
                    ):
                        shutil.rmtree(path)
                async with reference_lifespan(app):
                    if imports is not None and run_worker:
                        await imports.start()
                    yield
            finally:
                if imports is not None:
                    await imports.stop()
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Presentation", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.import_delivery = imports
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
                    connection, capabilities, staging
                ),
                presentation_import=Imports(connection, archive, imports),
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
    for router in (exchange_router, templates_router, projects_router, exports_router):
        app.include_router(
            router,
            prefix=SOURCE,
            tags=["presentation-workshop"],
            dependencies=[Depends(require_studio_auth)],
        )
    if schema_path is not None:
        schema = app.openapi()
        mounted = {
            (method.upper(), path)
            for path, methods in schema["paths"].items()
            if path.startswith("/v1/")
            for method in methods
        }
        if (
            mounted != OPERATIONS
            or {(item.method, item.path) for item in catalog.operations if item.service == SERVICE}
            != OPERATIONS
        ):
            raise ValueError("演示文稿项目路由归属不匹配")
        published = json.loads(schema_path.read_text())
        expected = public_contract(published, SERVICE, catalog)
        if public_contract(schema, SERVICE, catalog) != expected:
            raise ValueError("演示文稿项目 API 与发布契约不匹配")

    release = None
    if web_root is not None:
        release = load_release(web_root, SERVICE)
        if schema_path is None or release.api_sha256 != expected:
            raise ValueError("演示工坊浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        if (
            release is None
            or imports is None
            or not imports.is_healthy
            or not app.state.reference_delivery.is_healthy
        ):
            raise HTTPException(503, "presentation_release_or_delivery_workers_unavailable")
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": SERVICE, "version": release.build_id}

    return app
