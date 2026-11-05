"""The initial media endpoint slice has no asset/workshop ORM or monolith runner."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from studio.apps.media_rendering.galgame_export_jobs import GalgameExports
from studio.apps.media_rendering.galgame_frames import router as galgame_frames_router
from studio.apps.media_rendering.motion_jobs import MotionJobs
from studio.apps.media_rendering.motion_preview import router as motion_preview_router
from studio.apps.media_rendering.motion_transfer import router as motion_transfer_router
from studio.apps.media_rendering.previews import MediaPreviews
from studio.apps.media_rendering.storage.migrations.registry import MIGRATIONS
from studio.apps.media_rendering.storage.service_models import (
    GalgameExportJob,
    MotionRenderJob,
    VideoExportJob,
    VideoMediaJob,
)
from studio.apps.media_rendering.transport.galgame_capacity_http import (
    router as galgame_capacity_router,
)
from studio.apps.media_rendering.transport.galgame_export_routes import (
    router as galgame_exports_router,
)
from studio.apps.media_rendering.transport.motion_export_routes import (
    router as motion_export_router,
)
from studio.apps.media_rendering.transport.service import router
from studio.apps.media_rendering.transport.video_export_routes import router as video_export_router
from studio.apps.media_rendering.transport.video_media_routes import router as video_media_router
from studio.apps.media_rendering.video_audio import router as video_audio_router
from studio.apps.media_rendering.video_export_jobs import VideoExports
from studio.apps.media_rendering.video_frames import VideoFrameCache
from studio.apps.media_rendering.video_frames import router as video_frame_router
from studio.apps.media_rendering.video_media_jobs import VideoJobs
from studio.apps.media_rendering.visual_grids import router as visual_grid_router
from studio.apps.media_rendering.visual_samples import router as visual_samples_router
from studio.assembly.independent.media_rendering.reads import bind_media_reads
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.motion_compositor.motion_exports import ExportPeer
from studio.contracts.video_editor.video_exports import output_peer
from studio.contracts.video_editor.video_processing import originals_peer, video_peer
from studio.contracts.visual_workshop.visual_composition import (
    MAX_PLAN_BYTES as MAX_VISUAL_GRID_BYTES,
)
from studio.contracts.visual_workshop.visual_composition import RENDER as VISUAL_GRID
from studio.contracts.visual_workshop.visual_samples import (
    MAX_REQUEST_BYTES as MAX_VISUAL_SAMPLE_REQUEST,
)
from studio.contracts.visual_workshop.visual_samples import RENDER as VISUAL_SAMPLES
from studio.runtime.database.migrations import check
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.http.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from studio.runtime.http.request_limit import RequestLimit


def create_app(
    *,
    settings,
    public_key,
    catalog,
    identity,
    capabilities,
    version="development",
    run_worker=True,
    export_key=None,
    video_media_key=None,
    video_originals_key=None,
):
    database = Database(
        "rendering",
        settings.runtime_path,
        models=(GalgameExportJob, MotionRenderJob, VideoMediaJob, VideoExportJob),
        hide_parameters=True,
    )
    if database.path != settings.database_path:
        raise ValueError("Rendering 配置必须指向自己的数据目录")

    motion_jobs = MotionJobs(database=database, settings=settings, identity=identity)
    galgame_exports = GalgameExports(database, settings, identity, capabilities)
    if (video_media_key is None) != (video_originals_key is None):
        raise ValueError("剪辑派生需要两端专用对等凭据")
    video_jobs = (
        VideoJobs(
            database=database,
            settings=settings,
            identity=identity,
            client=capabilities.client,
            originals=originals_peer(video_originals_key),
        )
        if video_media_key is not None
        else None
    )

    video_exports = (
        VideoExports(
            database=database,
            settings=settings,
            identity=identity,
            client=capabilities.client,
            originals=originals_peer(video_originals_key),
            outputs=output_peer(video_originals_key),
        )
        if video_media_key is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "rendering", MIGRATIONS)
        try:
            if run_worker:
                await motion_jobs.start()
                await galgame_exports.start()
                if video_jobs is not None:
                    await video_jobs.start()
                    await video_exports.start()
            yield
        finally:
            if video_jobs is not None:
                await video_exports.stop()
                await video_jobs.stop()
            await galgame_exports.stop()
            await motion_jobs.stop()
            await capabilities.close()
            await identity.close()
            await database.close()

    app = FastAPI(
        title="FPL Rendering",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "rendering"
    app.state.settings, app.state.database = settings, database
    app.state.identity, app.state.capabilities = identity, capabilities
    app.state.media = MediaPreviews(settings)
    bind_media_reads(app)
    app.state.identity_public_key = public_key
    app.state.motion_frame_slots = asyncio.Semaphore(2)
    app.state.galgame_frame_slots = asyncio.Semaphore(2)
    app.state.visual_grid_slots = asyncio.Semaphore(2)
    app.state.visual_sample_slots = asyncio.Semaphore(2)
    app.state.galgame_exports = galgame_exports
    app.state.motion_jobs = motion_jobs
    app.state.motion_export_peer = ExportPeer(export_key) if export_key is not None else None
    app.state.motion_submission_locks = tuple(asyncio.Lock() for _ in range(16))
    app.state.video_jobs = video_jobs
    app.state.video_exports = video_exports
    app.include_router(video_export_router)
    app.include_router(galgame_capacity_router)
    app.include_router(galgame_frames_router)
    app.include_router(visual_grid_router)
    app.include_router(visual_samples_router)
    app.add_middleware(RequestLimit, prefix=VISUAL_SAMPLES, maximum=MAX_VISUAL_SAMPLE_REQUEST)
    app.add_middleware(RequestLimit, prefix=VISUAL_GRID, maximum=MAX_VISUAL_GRID_BYTES)
    app.include_router(galgame_exports_router)
    app.include_router(motion_transfer_router)
    app.state.video_frame_cache = VideoFrameCache()
    app.state.video_frame_slots = asyncio.Semaphore(2)
    app.state.video_audio_slots = asyncio.Semaphore(2)
    app.include_router(video_audio_router)
    app.include_router(video_frame_router)
    app.state.video_media_peer = (
        video_peer(video_media_key) if video_media_key is not None else None
    )
    app.include_router(video_media_router)
    app.include_router(motion_export_router)
    app.include_router(motion_preview_router)
    app.include_router(router, prefix="/v1")
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)

    async def asset_failure(request, exc):
        return await http_exception_handler(
            request,
            HTTPException(
                exc.status,
                {"code": exc.code, "message": str(exc), **exc.detail},
            ),
        )

    async def capability_failure(request, exc):
        status = exc.status if isinstance(exc, CapabilityDenied) else 503
        return await http_exception_handler(
            request,
            HTTPException(
                status,
                {"code": "media_source_unavailable", "message": "来源文件暂不可用或授权已失效"},
            ),
        )

    app.add_exception_handler(AssetError, asset_failure)
    app.add_exception_handler(CapabilityDenied, capability_failure)
    app.add_exception_handler(CapabilityUnavailable, capability_failure)
    app.add_middleware(SignedIdentity, service="rendering", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/v1/files/", maximum=128 * 1024)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "rendering", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "rendering", MIGRATIONS)
        if run_worker and not galgame_exports.is_healthy:
            raise HTTPException(503, "galgame_export_runner_unavailable")
        if run_worker and (
            not motion_jobs.is_healthy
            or (
                video_jobs is not None
                and (not video_jobs.is_healthy or not video_exports.is_healthy)
            )
        ):
            raise HTTPException(503, "motion_export_runner_unavailable")
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": "rendering"}

    expected = {
        (op.method, op.path): op.operation_id
        for op in catalog.operations
        if op.service == "rendering"
    }
    actual = {
        (method.upper(), path): op["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, op in methods.items()
        if path.startswith("/v1/")
    }
    if expected != actual:
        raise ValueError("媒体公开接口与聚合契约不匹配")
    return app
