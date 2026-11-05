"""Standalone Motion project and document operations."""

import asyncio
import json
from contextlib import asynccontextmanager
from shutil import rmtree

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from app.apps.motion_compositor.models import (
    MotionDocument,
    MotionOperationBatch,
    MotionProject,
    MotionTask,
)
from app.apps.motion_compositor.routes.projects import router
from app.deps import db_session, require_studio_auth
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.archive_transport import ArchiveTransport
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.capability_client import CapabilityClient
from fpl_runtime.database import Database
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.motion_assets import SOURCE, MotionAsset
from fpl_runtime.motion_exports import ExportPeer
from fpl_runtime.motion_snapshot import ARCHIVE_DOMAIN, ARCHIVE_PREFIX, ARCHIVE_PURPOSE, IMPORT
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime, reference_lifespan
from fpl_runtime.routing import RouteCatalog
from fpl_runtime.web import attach_web, load_release

from .export_delivery import ExportDelivery
from .export_routes import router as export_router
from .file_routes import router as file_router
from .handoff_routes import router as handoff_router
from .migrations.registry import MIGRATIONS
from .models import MotionExportBinding, MotionImportBatch, MotionReferenceMutation
from .preview_routes import router as preview_router
from .resources import ProjectResources
from .snapshot_imports import MotionImportDelivery, SnapshotImports
from .snapshot_routes import router as snapshot_router

SERVICE = "motion"
WEB_ROOT = "/apps/motion-compositor"
PAGES = (
    WEB_ROOT,
    WEB_ROOT + "/",
    WEB_ROOT + "/projects/{project_id}/editor",
    WEB_ROOT + "/projects/{project_id}/editor/",
)
PROJECTS = SOURCE + "/projects"
PROJECT = PROJECTS + "/{project_id}"
OPERATIONS = {
    ("GET", PROJECTS),
    ("POST", PROJECTS),
    ("GET", PROJECT),
    ("PATCH", PROJECT),
    ("DELETE", PROJECT),
    ("GET", PROJECT + "/document"),
    ("GET", PROJECT + "/preview/frame"),
    ("GET", PROJECT + "/snapshot"),
    ("GET", PROJECT + "/exports"),
    ("POST", PROJECT + "/exports"),
    ("GET", PROJECT + "/exports/{task_id}"),
    ("POST", PROJECT + "/exports/{task_id}/cancel"),
    ("POST", PROJECT + "/exports/{task_id}/video-editor-handoffs"),
    ("GET", PROJECT + "/exports/{task_id}/download/{format_name}"),
    ("POST", IMPORT),
    ("GET", SOURCE + "/import-sources"),
    ("GET", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets/import"),
    ("GET", PROJECT + "/assets/{asset_id}/file"),
    ("POST", PROJECT + "/document/operations"),
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
    web_root=None,
    archive_key=None,
    export_key=None,
):
    database = Database(
        SERVICE,
        state_root,
        models=(
            MotionProject,
            MotionDocument,
            MotionOperationBatch,
            MotionReferenceMutation,
            MotionImportBatch,
            MotionTask,
            MotionExportBinding,
        ),
        hide_parameters=True,
    )
    snapshot_staging = database.root / ".snapshot-exports"
    identity = LiveAuthorization(service=SERVICE, credential=credential, transport=transport)
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    export_delivery = (
        ExportDelivery(database.sessions, capabilities, ExportPeer(export_key))
        if export_key is not None
        else None
    )
    archive = (
        ArchiveTransport(
            capabilities,
            archive_key,
            service=SERVICE,
            purpose=ARCHIVE_PURPOSE,
            source_path=IMPORT,
            prefix=ARCHIVE_PREFIX,
            domain=ARCHIVE_DOMAIN,
            asset_model=MotionAsset,
            exact_mime=False,
        )
        if archive_key is not None
        else None
    )
    import_delivery = MotionImportDelivery(database.sessions, archive) if archive else None

    @asynccontextmanager
    async def lifespan(app):
        with service_lock(database.root):
            try:
                check(database.path, SERVICE, MIGRATIONS)
                if snapshot_staging.is_symlink():
                    raise ValueError("特效工程包暂存目录不能是符号链接")
                snapshot_staging.mkdir(exist_ok=True, mode=0o700)
                for item in snapshot_staging.glob("motion-snapshot-*.zip"):
                    if item.is_file() or item.is_symlink():
                        item.unlink()
                for item in snapshot_staging.glob("motion-import-*"):
                    if item.is_dir() and not item.is_symlink():
                        rmtree(item)
                async with reference_lifespan(app):
                    if import_delivery is not None and run_worker:
                        await import_delivery.start()
                    if export_delivery is not None and run_worker:
                        await export_delivery.start()
                    yield
            finally:
                if import_delivery is not None:
                    await import_delivery.stop()
                if export_delivery is not None:
                    await export_delivery.stop()
                await capabilities.close()
                await identity.close()
                await database.close()

    app = FastAPI(
        title="FPL Motion", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.motion_capabilities = capabilities
    app.state.motion_export_delivery = export_delivery
    app.state.motion_identity = identity
    app.state.snapshot_staging = snapshot_staging
    app.state.snapshot_slots = asyncio.Semaphore(2)
    app.state.motion_imports = (
        SnapshotImports(archive, import_delivery, snapshot_staging) if archive else None
    )
    app.state.motion_import_delivery = import_delivery
    install_reference_runtime(
        app,
        service=SERVICE,
        model=MotionReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )

    async def request_session(connection: HTTPConnection):
        async with database.sessions() as session:
            session.info["motion_project_resources"] = lambda db, _owner: ProjectResources(
                connection, db, capabilities, app.state.reference_mutations
            )
            yield session

    app.dependency_overrides[db_session] = request_session
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    for component in (
        router,
        file_router,
        preview_router,
        snapshot_router,
        export_router,
        handoff_router,
    ):
        app.include_router(
            component,
            prefix=SOURCE,
            tags=["motion-compositor"],
            dependencies=[Depends(require_studio_auth)],
        )
    if schema_path is not None:
        expected = RouteCatalog(
            operation for operation in catalog.operations if operation.service == SERVICE
        )
        schema = app.openapi()
        published = json.loads(schema_path.read_text())
        mounted = {
            (method.upper(), path)
            for path, operations in schema["paths"].items()
            if path.startswith("/v1/")
            for method in operations
        }
        if (
            mounted != OPERATIONS
            or {(operation.method, operation.path) for operation in expected.operations}
            != OPERATIONS
            or public_contract(schema, SERVICE, expected)
            != public_contract(published, SERVICE, expected)
        ):
            raise ValueError("特效文稿 API 与发布契约不匹配")

    if web_root is not None:
        release = load_release(web_root, SERVICE)
        if schema_path is None or release.api_sha256 != public_contract(
            published, SERVICE, catalog
        ):
            raise ValueError("特效工坊浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        runners = (app.state.reference_delivery, import_delivery, export_delivery)
        if web_root is None or not run_worker or any(runner is None for runner in runners):
            raise HTTPException(503, "motion_dependencies_unconfigured")
        check(database.path, SERVICE, MIGRATIONS)
        if any(not runner.is_healthy for runner in runners):
            raise HTTPException(503, "motion_worker_unavailable")
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": SERVICE}

    return app
