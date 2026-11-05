"""Standalone Video Editor uses only its own database and public contracts."""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection

from app.capabilities.asset_store.project_snapshots import cleanup_snapshot_staging
from app.deps import db_session, require_studio_auth
from studio.apps.asset_library.clients.archive_transfer import (
    ArchiveTransport,
    SnapshotArchiveAsset,
)
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.video_editor.asset_intake import AssetIntakes
from studio.apps.video_editor.handoffs.motion_handoffs import MotionHandoffs
from studio.apps.video_editor.handoffs.segment_handoff_delivery import SegmentDelivery
from studio.apps.video_editor.media_delivery import MediaDelivery
from studio.apps.video_editor.project_layouts import ProjectLayouts
from studio.apps.video_editor.render_delivery import RenderDelivery
from studio.apps.video_editor.snapshot_exports import SnapshotSettings
from studio.apps.video_editor.snapshot_imports import SnapshotDelivery, SnapshotImports
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from studio.apps.video_editor.storage.service_models import (
    VideoAssetIntake,
    VideoImportBatch,
    VideoMediaDispatch,
    VideoMotionHandoff,
    VideoReferenceMutation,
    VideoRenderDispatch,
    VideoSegmentDelivery,
)
from studio.apps.video_editor.timeline_media import TimelineMedia
from studio.apps.video_editor.transport.audio_seam_routes import router as audio_seam_router
from studio.apps.video_editor.transport.bake_routes import router as bake_router
from studio.apps.video_editor.transport.clip_merge_routes import router as clip_merge_router
from studio.apps.video_editor.transport.frame_routes import router as frame_router
from studio.apps.video_editor.transport.galgame_handoff_http import router as galgame_handoff_router
from studio.apps.video_editor.transport.handoff_routes import router as handoff_router
from studio.apps.video_editor.transport.media_routes import router as media_router
from studio.apps.video_editor.transport.project_reveal_routes import router as reveal_router
from studio.apps.video_editor.transport.render_routes import router as render_router
from studio.apps.video_editor.transport.segment_routes import router as segment_router
from studio.apps.video_editor.transport.snapshot_routes import router as snapshot_router
from studio.apps.video_editor.transport.website.projects import router as project_router
from studio.apps.video_editor.transport.website.render_preflight import router as preflight_router
from studio.apps.video_editor.transport.website.tasks import router as tasks_router
from studio.apps.video_editor.transport.website.timeline import router as timeline_router
from studio.assembly.independent.asset_references import (
    install_reference_runtime,
    reference_lifespan,
)
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.video_editor.video_processing import video_peer
from studio.contracts.video_editor.video_segment_handoff import visual_peer as segment_visual_peer
from studio.contracts.video_editor.video_snapshot import (
    ARCHIVE_DOMAIN,
    ARCHIVE_PREFIX,
    ARCHIVE_PURPOSE,
    IMPORT,
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
    ("POST", PROJECT + "/open-folder"),
    ("GET", PROJECT + "/timeline"),
    ("GET", PROJECT + "/snapshot"),
    ("POST", IMPORT),
    ("POST", PROJECT + "/audio-seams/candidates"),
    ("GET", PROJECT + "/preview/frame"),
    ("GET", PROJECT + "/text-clips/{clip_id}/layer"),
    ("GET", PROJECT + "/asset-bakes/{task_id}"),
    ("POST", PROJECT + "/assets/{asset_id}/bakes"),
    ("GET", PROJECT + "/renders"),
    ("POST", PROJECT + "/renders/preflight"),
    ("POST", PROJECT + "/renders"),
    ("POST", PROJECT + "/renders/{task_id}/cancel"),
    ("GET", PROJECT + "/renders/{task_id}"),
    ("DELETE", PROJECT + "/renders/{task_id}"),
    ("GET", PROJECT + "/segment-exports"),
    ("POST", PROJECT + "/segment-exports"),
    ("POST", PROJECT + "/segment-exports/{task_id}/cancel"),
    ("GET", PROJECT + "/segment-exports/{task_id}/download"),
    ("GET", PROJECT + "/segment-exports/{task_id}"),
    ("GET", PROJECT + "/clip-merges"),
    ("POST", PROJECT + "/clip-merges"),
    ("POST", PROJECT + "/clip-merges/{task_id}/cancel"),
    ("GET", PROJECT + "/clip-merges/{task_id}"),
    ("POST", PROJECT + "/timeline/operations"),
    ("GET", SOURCE + "/import-sources"),
    ("GET", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets"),
    ("POST", PROJECT + "/assets/import"),
    ("PATCH", PROJECT + "/assets/{asset_id}"),
    ("DELETE", PROJECT + "/assets/{asset_id}"),
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
    archive_key=None,
    segment_visual_key=None,
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
            VideoImportBatch,
            VideoMediaDispatch,
            VideoRenderDispatch,
            VideoSegmentDelivery,
            VideoMotionHandoff,
        ),
    )
    capabilities = CapabilityClient(
        service=SERVICE, credential=credential, catalog=catalog, transport=transport
    )

    asset_intakes = AssetIntakes(database.sessions, capabilities)
    snapshot_settings = SnapshotSettings(database.root)
    archive = (
        ArchiveTransport(
            capabilities,
            archive_key,
            service=SERVICE,
            purpose=ARCHIVE_PURPOSE,
            source_path=IMPORT,
            prefix=ARCHIVE_PREFIX,
            domain=ARCHIVE_DOMAIN,
            asset_model=SnapshotArchiveAsset,
            exact_mime=False,
        )
        if archive_key is not None
        else None
    )
    archive_delivery = SnapshotDelivery(database.sessions, archive) if archive else None
    media_delivery = (
        MediaDelivery(database.sessions, capabilities.client, video_peer(media_key))
        if media_key is not None
        else None
    )

    segment_delivery = (
        SegmentDelivery(
            database.sessions, capabilities.client, segment_visual_peer(segment_visual_key)
        )
        if segment_visual_key is not None
        else None
    )
    render_delivery = (
        RenderDelivery(
            database.sessions, capabilities.client, video_peer(media_key), segment_delivery
        )
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
            if (database.root / ".tmp").is_symlink():
                raise ValueError("剪辑快照暂存目录无效")
            cleanup_snapshot_staging(snapshot_settings)
            try:
                async with reference_lifespan(_app):
                    if run_worker:
                        await asset_intakes.start()
                        if archive_delivery is not None:
                            await archive_delivery.start()
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
                if archive_delivery is not None:
                    await archive_delivery.stop()
                await asset_intakes.stop()
                await handoff_identity.close()
                await capabilities.close()
                await database.close()

    app = FastAPI(
        title="FPL Video Editor", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.database = database
    app.state.capabilities = capabilities
    app.state.video_snapshot_settings = snapshot_settings
    app.state.snapshot_slots = asyncio.Semaphore(2)
    app.state.video_snapshot_imports = (
        SnapshotImports(archive, archive_delivery, snapshot_settings) if archive else None
    )
    app.state.video_archive_delivery = archive_delivery
    app.state.asset_intakes = asset_intakes
    app.state.media_delivery = media_delivery
    app.state.render_delivery = render_delivery
    app.state.segment_handoff_delivery = segment_delivery
    app.state.identity_public_key = public_key
    app.state.handoff_identity = handoff_identity
    app.state.motion_handoffs = motion_handoffs
    app.include_router(handoff_router)
    app.include_router(galgame_handoff_router)
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
        clip_merge_router,
        bake_router,
        segment_router,
        snapshot_router,
        reveal_router,
    ):
        app.include_router(
            router,
            prefix=SOURCE,
            tags=["video-editor"],
            dependencies=[Depends(require_studio_auth)],
        )

    expected = RouteCatalog(
        operation for operation in catalog.operations if operation.service == SERVICE
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
        runners = (
            app.state.reference_delivery,
            asset_intakes,
            archive_delivery,
            media_delivery,
            render_delivery,
            motion_handoffs,
        )
        if (
            web_root is None
            or not run_worker
            or segment_delivery is None
            or any(runner is None for runner in runners)
        ):
            raise HTTPException(503, "video_dependencies_unconfigured")
        check(database.path, SERVICE, MIGRATIONS)
        if any(not runner.is_healthy for runner in runners):
            raise HTTPException(503, "video_worker_unavailable")
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": SERVICE}

    return app
