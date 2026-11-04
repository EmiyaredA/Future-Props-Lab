"""The initial media endpoint slice has no asset/workshop ORM or monolith runner."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.capabilities.asset_store.errors import AssetError
from app.problem_details import (
    http_exception_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.database import Database
from fpl_runtime.migrations import check
from fpl_runtime.motion_exports import ExportPeer
from fpl_runtime.request_limit import RequestLimit
from fpl_runtime.video_processing import originals_peer, video_peer

from .migrations.registry import MIGRATIONS
from .models import MotionRenderJob, VideoMediaJob
from .motion_export_routes import router as motion_export_router
from .motion_jobs import MotionJobs
from .motion_preview import router as motion_preview_router
from .previews import MediaPreviews
from .routes import router
from .video_media_jobs import VideoJobs
from .video_media_routes import router as video_media_router


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
        models=(MotionRenderJob, VideoMediaJob),
        hide_parameters=True,
    )
    if database.path != settings.database_path:
        raise ValueError("Rendering 配置必须指向自己的数据目录")

    motion_jobs = MotionJobs(database=database, settings=settings, identity=identity)
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

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "rendering", MIGRATIONS)
        try:
            if run_worker:
                await motion_jobs.start()
                if video_jobs is not None:
                    await video_jobs.start()
            yield
        finally:
            if video_jobs is not None:
                await video_jobs.stop()
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
    app.state.identity_public_key = public_key
    app.state.motion_frame_slots = asyncio.Semaphore(2)
    app.state.motion_jobs = motion_jobs
    app.state.motion_export_peer = ExportPeer(export_key) if export_key is not None else None
    app.state.motion_submission_locks = tuple(asyncio.Lock() for _ in range(16))
    app.state.video_jobs = video_jobs
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
        if run_worker and (
            not motion_jobs.is_healthy or (video_jobs is not None and not video_jobs.is_healthy)
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
