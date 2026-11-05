"""Owned files, project placement, retention and recoverable cleanup lifecycle."""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.capabilities.asset_store.library import AssetError
from app.problem_details import (
    http_exception_handler,
    revision_conflict_handler,
    storage_operational_error_handler,
    validation_exception_handler,
)
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.authentication import SignedIdentity
from fpl_runtime.database import Database
from fpl_runtime.galgame_assets import MAX_QUERY_BYTES as MAX_GALGAME_QUERY_BYTES
from fpl_runtime.galgame_assets import PREFIX as GALGAME_FILES
from fpl_runtime.migrations import check
from fpl_runtime.request_limit import RequestLimit
from fpl_runtime.video_segment_handoff import ASSET_HANDOFFS
from fpl_runtime.video_segment_handoff import asset_peer as visual_segment_peer
from fpl_runtime.visual_acceptance_assets import PREFIX as VISUAL_ACCEPTANCE_FILES
from fpl_runtime.visual_agent_review import MAX_JOB_BYTES, SOURCES
from fpl_runtime.visual_assistant import ASSET_PREFIX as CONVERSATION_FILES
from fpl_runtime.visual_assistant import INPUT_PREFIX as ASSISTANT_INPUTS
from fpl_runtime.visual_assistant import MAX_QUERY_BYTES as MAX_CONVERSATION_QUERY_BYTES
from fpl_runtime.visual_composition import ASSETS as VISUAL_GRID_ASSETS
from fpl_runtime.visual_composition import MAX_PLAN_BYTES as MAX_VISUAL_GRID_BYTES
from fpl_runtime.visual_generation import ASSETS as VISUAL_GENERATION_ASSETS
from fpl_runtime.visual_samples import ASSETS as VISUAL_SAMPLE_ASSETS
from fpl_runtime.visual_samples import MAX_REQUEST_BYTES as MAX_VISUAL_SAMPLE_REQUEST
from fpl_runtime.visual_snapshot import ASSETS as VISUAL_SNAPSHOT_FILES
from fpl_runtime.visual_snapshot import MAX_QUERY_BYTES as MAX_VISUAL_SNAPSHOT_QUERY_BYTES

from .deletions import FileCleanup
from .galgame_upload_recovery import recover_uploads
from .layout import StorageLayouts
from .migrations.registry import MIGRATIONS
from .models import MODELS
from .reference_changes import ReferenceChanges
from .retention_api import router as retention_router
from .routes.annotation_assets import router as annotation_assets_router
from .routes.community_assets import router as community_assets_router
from .routes.community_uploads import router as community_uploads_router
from .routes.files import router as files_router
from .routes.galgame_archives import router as galgame_archives_router
from .routes.galgame_assets import router as galgame_assets_router
from .routes.galgame_upload import router as galgame_upload_router
from .routes.layout import router as layout_router
from .routes.library_inputs import router as library_inputs_router
from .routes.library_outputs import router as library_outputs_router
from .routes.motion_archives import router as motion_archives_router
from .routes.motion_assets import router as motion_assets_router
from .routes.motion_preview import router as motion_preview_router
from .routes.motion_snapshot import router as motion_snapshot_router
from .routes.presentation_archives import router as presentation_archives_router
from .routes.presentation_assets import router as presentation_assets_router
from .routes.project_links import router as links_router
from .routes.project_reveal import router as project_reveal_router
from .routes.thought_archives import router as thought_archives_router
from .routes.thought_library import router as thought_library_router
from .routes.thought_uploads import router as thought_uploads_router
from .routes.video_archives import router as video_archives_router
from .routes.video_assets import router as video_assets_router
from .routes.video_originals import router as video_originals_router
from .routes.video_render_outputs import router as video_render_outputs_router
from .routes.video_segment_bundles import router as video_segment_bundles_router
from .routes.video_segment_handoffs import router as video_segment_handoffs_router
from .routes.video_segment_outputs import router as video_segment_outputs_router
from .routes.visual_acceptance import router as visual_acceptance_router
from .routes.visual_agent_media import router as visual_agent_media_router
from .routes.visual_archives import router as visual_archives_router
from .routes.visual_assistant import router as conversation_assets_router
from .routes.visual_generation import router as visual_generation_router
from .routes.visual_grids import router as visual_grids_router
from .routes.visual_sample_assets import router as visual_sample_assets_router
from .routes.visual_snapshot import router as visual_snapshot_router
from .routes.visual_upload import router as visual_upload_router
from .video_segment_bundles import cleanup_bundles
from .video_segment_handoffs import SegmentHandoffFiles
from .visual_upload_stages import recover as recover_visual_uploads

logger = logging.getLogger(__name__)


class PrivateResponses:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def private(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if scope["path"].startswith(("/v1/", "/_internal/")) or not headers.get(
                    "Cache-Control"
                ):
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, private if scope["type"] == "http" else send)


def create_app(
    *,
    settings,
    catalog,
    public_key,
    identity,
    capabilities,
    version="development",
    web_root=None,
    cleanup=True,
    community_asset_checks=None,
    thought_upload_result_key=None,
    presentation_archive_key=None,
    motion_archive_key=None,
    video_originals_key=None,
    video_archive_key=None,
    galgame_archive_key=None,
    visual_archive_key=None,
    visual_segment_assets_key=None,
):
    database = Database("assets", settings.runtime_path, models=MODELS)
    if settings.database_path != database.path:
        raise ValueError("Assets 配置必须指向自己的数据目录")
    cleaner = FileCleanup(database, settings)

    async def maintain():
        while True:
            try:
                await cleaner.run_once()
            except Exception:
                # File paths, account data and exception payloads stay out of logs.
                logger.error("asset_cleanup_cycle_failed")
            await asyncio.sleep(2)

    @asynccontextmanager
    async def lifespan(_app):
        check(database.path, "assets", MIGRATIONS)
        cleanup_bundles(settings)
        await recover_uploads(database, settings)
        await recover_visual_uploads(database, settings)
        task = asyncio.create_task(maintain()) if cleanup else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            if community_asset_checks is not None:
                await community_asset_checks.close()
            await identity.close()
            await capabilities.close()
            await database.close()

    app = FastAPI(
        title="FPL Assets",
        version=version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.service_id = "assets"
    app.state.database, app.state.settings = database, settings
    app.state.identity, app.state.capabilities = identity, capabilities
    app.state.identity_public_key = public_key
    from fpl_runtime.video_exports import output_peer
    from fpl_runtime.video_processing import originals_peer

    app.state.video_originals_peer = (
        originals_peer(video_originals_key) if video_originals_key is not None else None
    )
    app.state.community_asset_checks = community_asset_checks
    app.state.video_output_peer = (
        output_peer(video_originals_key) if video_originals_key is not None else None
    )
    if thought_upload_result_key is not None:
        from fpl_runtime.thought_archives import ArchiveAuthenticator
        from fpl_runtime.thought_uploads import ThoughtUploadReceiptAuthenticator

        app.state.thought_archive_auth = ArchiveAuthenticator(thought_upload_result_key)
        app.state.thought_upload_results = ThoughtUploadReceiptAuthenticator(
            thought_upload_result_key
        )
    if presentation_archive_key is not None:
        from fpl_runtime.presentation_archives import DOMAIN
        from fpl_runtime.thought_archives import ArchiveAuthenticator

        app.state.presentation_archive_auth = ArchiveAuthenticator(
            presentation_archive_key, domain=DOMAIN
        )
    if motion_archive_key is not None:
        from fpl_runtime.motion_snapshot import ARCHIVE_DOMAIN
        from fpl_runtime.thought_archives import ArchiveAuthenticator

        app.state.motion_archive_auth = ArchiveAuthenticator(
            motion_archive_key, domain=ARCHIVE_DOMAIN
        )
    if galgame_archive_key is not None:
        from fpl_runtime.galgame_snapshot import ARCHIVE_DOMAIN
        from fpl_runtime.thought_archives import ArchiveAuthenticator

        app.state.galgame_archive_auth = ArchiveAuthenticator(
            galgame_archive_key, domain=ARCHIVE_DOMAIN
        )
    if visual_archive_key is not None:
        from fpl_runtime.thought_archives import ArchiveAuthenticator
        from fpl_runtime.visual_snapshot import ARCHIVE_DOMAIN

        app.state.visual_archive_auth = ArchiveAuthenticator(
            visual_archive_key, domain=ARCHIVE_DOMAIN
        )
    if video_archive_key is not None:
        from fpl_runtime.thought_archives import ArchiveAuthenticator
        from fpl_runtime.video_snapshot import ARCHIVE_DOMAIN

        app.state.video_archive_auth = ArchiveAuthenticator(
            video_archive_key, domain=ARCHIVE_DOMAIN
        )
    app.state.reference_changes = ReferenceChanges(database)
    app.state.layouts = StorageLayouts(database, settings)
    app.state.file_cleanup = cleaner
    app.state.video_segment_handoffs = SegmentHandoffFiles(database, settings)
    app.state.visual_segment_assets_peer = (
        visual_segment_peer(visual_segment_assets_key) if visual_segment_assets_key else None
    )
    for router in (files_router, layout_router, links_router):
        app.include_router(router, prefix="/v1")
    app.include_router(retention_router)
    app.include_router(visual_upload_router)
    app.include_router(project_reveal_router)
    app.include_router(conversation_assets_router)
    app.add_middleware(RequestLimit, prefix=ASSISTANT_INPUTS, maximum=16 * 1024)
    app.include_router(visual_acceptance_router)
    app.include_router(visual_generation_router)
    app.add_middleware(RequestLimit, prefix=VISUAL_GENERATION_ASSETS, maximum=32 * 1024)
    app.include_router(visual_grids_router)
    app.add_middleware(RequestLimit, prefix=VISUAL_GRID_ASSETS, maximum=MAX_VISUAL_GRID_BYTES)
    app.include_router(visual_sample_assets_router)
    app.include_router(visual_agent_media_router)
    app.add_middleware(RequestLimit, prefix=SOURCES, maximum=MAX_JOB_BYTES)
    app.add_middleware(RequestLimit, prefix=VISUAL_SAMPLE_ASSETS, maximum=MAX_VISUAL_SAMPLE_REQUEST)
    app.include_router(visual_snapshot_router)
    app.add_middleware(
        RequestLimit, prefix=VISUAL_SNAPSHOT_FILES, maximum=MAX_VISUAL_SNAPSHOT_QUERY_BYTES
    )
    app.add_middleware(RequestLimit, prefix=VISUAL_ACCEPTANCE_FILES, maximum=64 * 1024)
    app.add_middleware(
        RequestLimit, prefix=CONVERSATION_FILES, maximum=MAX_CONVERSATION_QUERY_BYTES
    )
    app.include_router(galgame_assets_router)
    app.include_router(galgame_upload_router)
    app.add_middleware(RequestLimit, prefix=GALGAME_FILES, maximum=MAX_GALGAME_QUERY_BYTES)
    app.include_router(library_inputs_router)
    app.include_router(library_outputs_router)
    app.include_router(thought_library_router)
    app.include_router(annotation_assets_router)
    app.include_router(presentation_assets_router)
    app.include_router(motion_assets_router)
    app.include_router(video_archives_router)
    app.include_router(galgame_archives_router)
    app.include_router(visual_archives_router)
    app.include_router(video_assets_router)
    app.include_router(video_originals_router)
    app.include_router(video_render_outputs_router)
    app.include_router(video_segment_bundles_router)
    app.include_router(video_segment_handoffs_router)
    app.add_middleware(RequestLimit, prefix=ASSET_HANDOFFS, maximum=16 * 1024)
    app.include_router(video_segment_outputs_router)
    app.include_router(motion_archives_router)
    app.include_router(motion_preview_router)
    app.include_router(motion_snapshot_router)
    app.include_router(presentation_archives_router)
    app.include_router(thought_uploads_router)
    app.include_router(thought_archives_router)
    app.include_router(community_assets_router)
    app.include_router(community_uploads_router)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RevisionConflictError, revision_conflict_handler)
    app.add_exception_handler(OperationalError, storage_operational_error_handler)

    async def asset_failure(request, exc):
        return await http_exception_handler(
            request,
            HTTPException(
                exc.status,
                {"code": exc.code, "message": str(exc), **exc.detail},
            ),
        )

    app.add_exception_handler(AssetError, asset_failure)
    if web_root is not None:
        from fpl_runtime.protocol_hash import public_contract
        from fpl_runtime.web import attach_web, load_release

        release = load_release(web_root, "assets")
        if release.api_sha256 != public_contract(app.openapi(), "assets", catalog):
            raise ValueError("素材页面与服务契约不匹配")
        attach_web(app, release, pages=("/files", "/files/"))
    app.add_middleware(SignedIdentity, service="assets", public_key=public_key, catalog=catalog)
    app.add_middleware(RequestLimit, prefix="/_internal/v1/retention/", maximum=2 * 1024 * 1024)
    app.add_middleware(
        RequestLimit, prefix="/_internal/v1/thought-library/metadata/", maximum=2 * 1024 * 1024
    )
    app.add_middleware(PrivateResponses)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "assets", "version": version}

    @app.get("/ready")
    async def ready():
        check(database.path, "assets", MIGRATIONS)
        async with database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ready", "service": "assets"}

    expected = {
        (op.method, op.path): op.operation_id for op in catalog.operations if op.service == "assets"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, methods in app.openapi()["paths"].items()
        for method, operation in methods.items()
        if path.startswith("/v1/")
    }
    if actual != expected:
        raise ValueError("素材公共接口与聚合契约不匹配")
    return app
