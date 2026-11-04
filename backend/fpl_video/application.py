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
from app.apps.video_editor.routes.render_preflight import router as preflight_router
from app.apps.video_editor.routes.tasks import router as tasks_router
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
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import check
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.reference_runtime import install_reference_runtime, reference_lifespan
from fpl_runtime.routing import RouteCatalog
from fpl_runtime.video_processing import video_peer
from fpl_runtime.web import attach_web, load_release

from .asset_intake import AssetIntakes
from .audio_seam_routes import router as audio_seam_router
from .frame_routes import router as frame_router
from .handoff_routes import router as handoff_router
from .media_delivery import MediaDelivery
from .media_routes import router as media_router
from .migrations.registry import MIGRATIONS
from .models import (
    VideoAssetIntake,
    VideoMediaDispatch,
    VideoMotionHandoff,
    VideoReferenceMutation,
    VideoRenderDispatch,
)
from .motion_handoffs import MotionHandoffs
from .project_layouts import ProjectLayouts
from .render_delivery import RenderDelivery
from .render_routes import router as render_router
from .timeline_media import TimelineMedia

SERVICE = "video"
WEB_ROOT = "/apps/video-editor"
PAGES = (
    WEB_ROOT,
    WEB_ROOT + "/",
    WEB_ROOT + "/tasks",
    WEB_ROOT + "/tasks/",
    WEB_ROOT + "/projects/{project_id}/editor",
    WEB_ROOT + "/projects/{project_id}/editor/",
)
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
    ("POST", PROJECT + "/audio-seams/candidates"),
    ("GET", PROJECT + "/preview/frame"),
    ("GET", PROJECT + "/text-clips/{clip_id}/layer"),
    ("GET", PROJECT + "/asset-bakes/{task_id}"),
    ("GET", PROJECT + "/renders"),
    ("POST", PROJECT + "/renders/preflight"),
    ("POST", PROJECT + "/renders"),
    ("POST", PROJECT + "/renders/{task_id}/cancel"),
    ("GET", PROJECT + "/renders/{task_id}"),
    ("GET", PROJECT + "/segment-exports"),
    ("GET", PROJECT + "/segment-exports/{task_id}"),
    ("GET", PROJECT + "/clip-merges"),
    ("GET", PROJECT + "/clip-merges/{task_id}"),
    ("POST", PROJECT + "/timeline/operations"),
    ("GET", SOURCE + "/import-sources"),
    ("GET", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets/import"),
    ("POST", PROJECT + "/assets/{asset_id}/proxy/retry"),
    ("GET", PROJECT + "/assets/{asset_id}/{variant}"),
}


def create_app(
    *,
    state_root,
    catalog,
    public_key,
    schema_path,
    credential,
    transport=None,
    run_worker=True,
    media_key=None,
    web_root=None,
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
            VideoMediaDispatch,
            VideoRenderDispatch,
            VideoMotionHandoff,
        ),
    )
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    asset_intakes = AssetIntakes(database.sessions, capabilities)
    media_delivery = (
        MediaDelivery(database.sessions, capabilities.client, video_peer(media_key))
        if media_key is not None
        else None
    )

    render_delivery = (
        RenderDelivery(database.sessions, capabilities.client, video_peer(media_key))
        if media_key is not None
        else None
    )

    handoff_identity = LiveAuthorization(
        service=SERVICE, credential=credential, transport=transport
    )
    motion_handoffs = (
        MotionHandoffs(database.sessions, capabilities.client, video_peer(media_key))
        if media_key is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(_app):
        with service_lock(database.root):
            check(database.path, SERVICE, MIGRATIONS)
            try:
                async with reference_lifespan(_app):
                    if run_worker:
                        await asset_intakes.start()
                        if media_delivery is not None:
                            await media_delivery.start()
                            await render_delivery.start()
                            await motion_handoffs.start()
                    yield
            finally:
                if media_delivery is not None:
                    await motion_handoffs.stop()
                    await render_delivery.stop()
                    await media_delivery.stop()
                await asset_intakes.stop()
                await handoff_identity.close()
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Video Editor", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.capabilities = capabilities
    app.state.asset_intakes = asset_intakes
    app.state.media_delivery = media_delivery
    app.state.render_delivery = render_delivery
    app.state.identity_public_key = public_key
    app.state.handoff_identity = handoff_identity
    app.state.motion_handoffs = motion_handoffs
    app.include_router(handoff_router)
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
    for router in (
        project_router,
        timeline_router,
        media_router,
        tasks_router,
        frame_router,
        audio_seam_router,
        preflight_router,
        render_router,
    ):
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
    published = json.loads(schema_path.read_text())
    if (
        mounted != OPERATIONS
        or {(operation.method, operation.path) for operation in expected.operations} != OPERATIONS
        or public_contract(schema, SERVICE, expected)
        != public_contract(published, SERVICE, expected)
    ):
        raise ValueError("视频剪辑项目接口与发布契约不匹配")
    if web_root is not None:
        release = load_release(web_root, SERVICE)
        if release.api_sha256 != public_contract(published, SERVICE, catalog):
            raise ValueError("视频剪辑浏览器程序与 API 契约不匹配")
        attach_web(app, release, pages=PAGES)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE}

    @app.get("/ready")
    async def ready():
        raise HTTPException(503, "video_cutover_incomplete")

    return app
