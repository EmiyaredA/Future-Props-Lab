"""Standalone Video Editor uses only its own database and public contracts."""

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.routes.projects import router as project_router
from app.apps.video_editor.routes.timeline import router as timeline_router
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
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime, reference_lifespan
from fpl_runtime.routing import RouteCatalog

from .asset_intake import AssetIntakes
from .media_routes import router as media_router
from .migrations.registry import MIGRATIONS
from .models import VideoAssetIntake, VideoReferenceMutation
from .project_layouts import ProjectLayouts
from .timeline_media import TimelineMedia

SERVICE = "video"
SOURCE = "/v1/video-editor"
PROJECTS = SOURCE + "/projects"
PROJECT = PROJECTS + "/{project_id}"
OPERATIONS = {
    ("GET", PROJECTS),
    ("POST", PROJECTS),
    ("GET", PROJECT),
    ("PATCH", PROJECT),
    ("DELETE", PROJECT),
    ("GET", PROJECT + "/timeline"),
    ("POST", PROJECT + "/timeline/operations"),
    ("GET", SOURCE + "/import-sources"),
    ("GET", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets/import"),
}


def create_app(
    *, state_root, catalog, public_key, schema_path, credential, transport=None, run_worker=True
):
    database = Database(
        SERVICE,
        state_root,
        models=(
            VideoEditorProject,
            VideoEditorTimeline,
            VideoEditorOperationBatch,
            VideoEditorAssetMetadata,
            VideoEditorTask,
            VideoReferenceMutation,
            VideoAssetIntake,
        ),
    )
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    asset_intakes = AssetIntakes(database.sessions, capabilities)

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            check(database.path, SERVICE, MIGRATIONS)
            try:
                async with reference_lifespan(_app):
                    if run_worker:
                        await asset_intakes.start()
                    yield
            finally:
                await asset_intakes.stop()
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Video Editor", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.capabilities = capabilities
    app.state.asset_intakes = asset_intakes
    install_reference_runtime(
        app,
        service=SERVICE,
        model=VideoReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )

    async def request_session(connection: HTTPConnection):
        def project_layouts(session, owner):
            return ProjectLayouts(connection, session, owner, app)

        def timeline_assets(session, owner):
            return TimelineMedia(connection, session, owner, capabilities)

        async with database.sessions(
            info={
                "video_project_layouts": project_layouts,
                "video_timeline_assets": timeline_assets,
            }
        ) as session:
            yield session

    app.dependency_overrides[db_session] = request_session
    app.add_middleware(SignedIdentity, service=SERVICE, public_key=public_key, catalog=catalog)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    for router in (project_router, timeline_router, media_router):
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
