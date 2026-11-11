"""Independent Visual application with owner-side certification."""

import asyncio
import json
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, HTTPException
from sqlalchemy import text

from studio.apps.asset_library.clients.archive_transfer import (
    ArchiveTransport,
    SnapshotArchiveAsset,
)
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.visual_workshop.acceptance.acceptance_options import (
    router as acceptance_options_router,
)
from studio.apps.visual_workshop.acceptance.review_routes import router as review_router
from studio.apps.visual_workshop.acceptance.standard_routes import router as standard_router
from studio.apps.visual_workshop.composition.composition_runner import CompositionRunner
from studio.apps.visual_workshop.generation.generation_runner import GenerationRunner
from studio.apps.visual_workshop.generation_routes import reads as generation_records_router
from studio.apps.visual_workshop.handoffs.segment_handoffs import SegmentHandoffs
from studio.apps.visual_workshop.review.review_runner import ReviewRunner
from studio.apps.visual_workshop.snapshots.snapshot_exports import SnapshotSettings
from studio.apps.visual_workshop.snapshots.snapshot_imports import SnapshotDelivery, SnapshotImports
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.visual_workshop.storage.models import VisualWorkshopProject
from studio.apps.visual_workshop.storage.service_models import (
    MODELS,
    VisualCanvasReferenceMutation,
    VisualCertificationReceipt,
)
from studio.apps.visual_workshop.transport.acceptance_nodes_http import (
    router as acceptance_nodes_router,
)
from studio.apps.visual_workshop.transport.acceptance_samples_http import router as samples_router
from studio.apps.visual_workshop.transport.catalog_http import (
    acceptance as acceptance_catalog_router,
)
from studio.apps.visual_workshop.transport.catalog_http import (
    generation as generation_catalog_router,
)
from studio.apps.visual_workshop.transport.composition_http import router as composition_router
from studio.apps.visual_workshop.transport.generation_http import router as generation_router
from studio.apps.visual_workshop.transport.outputs_http import router as outputs_router
from studio.apps.visual_workshop.transport.projects_http import router as project_router
from studio.apps.visual_workshop.transport.repair_routes import router as repair_router
from studio.apps.visual_workshop.transport.review_authority_http import (
    router as review_authority_router,
)
from studio.apps.visual_workshop.transport.segment_handoff_routes import (
    router as segment_handoff_router,
)
from studio.apps.visual_workshop.transport.segment_target_routes import (
    router as segment_target_router,
)
from studio.apps.visual_workshop.transport.snapshot_http import router as snapshot_router
from studio.assembly.http_dependencies import require_studio_auth
from studio.assembly.independent.asset_references import install_reference_runtime
from studio.assembly.independent.certified_project import create_certification_app
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.video_editor.video_segment_handoff import (
    VISUAL_HANDOFFS,
    asset_peer,
    visual_peer,
)
from studio.contracts.visual_workshop.visual_generation import PEER_DOMAIN
from studio.contracts.visual_workshop.visual_snapshot import (
    ARCHIVE_DOMAIN,
    ARCHIVE_PREFIX,
    ARCHIVE_PURPOSE,
    IMPORT,
)
from studio.runtime.files.project_archives import cleanup_snapshot_staging
from studio.runtime.http.capability_client import CapabilityClient
from studio.runtime.http.request_limit import RequestLimit
from studio.runtime.http.web import attach_web, load_release
from studio.runtime.messaging.timed_peer import TimedPeer

PAGES = (
    "/apps/visual-workshop",
    "/apps/visual-workshop/tasks",
    "/apps/visual-workshop/projects/{project_id}/canvas",
    "/apps/visual-workshop/projects/{project_id}/assets",
)


def create_app(
    *,
    state_root,
    public_key,
    credential,
    catalog,
    transport=None,
    run_worker=True,
    video_segment_key=None,
    segment_assets_key=None,
    web_root=None,
    schema_path=None,
    archive_key=None,
    generation_key=None,
):
    if bool(video_segment_key) != bool(segment_assets_key):
        raise ValueError("Visual 分段交接需要独立的 Video 和 Assets 对等凭据")
    if (
        video_segment_key is not None
        and len({video_segment_key, segment_assets_key, credential}) != 3
    ):
        raise ValueError("Visual 分段交接凭据必须独立")

    async def ready(instance):
        if not all((web_root, archive_key, generation_key, video_segment_key)):
            raise HTTPException(503, "visual_production_dependencies_missing")
        state = instance.state
        if not state.public_routes_complete:
            raise HTTPException(503, "visual_route_coverage_incomplete")
        if run_worker and not all(
            runner.is_healthy
            for runner in (
                state.project_certifications,
                state.reference_delivery,
                state.snapshot_imports.delivery,
                state.generation_runner,
                state.composition_runner,
                state.review_runner,
            )
        ):
            raise HTTPException(503, "visual_runner_unavailable")
        async with state.database.sessions() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ready", "service": "visual"}

    app = create_certification_app(
        service="visual",
        root=state_root,
        models=MODELS,
        migrations=MIGRATIONS,
        project=VisualWorkshopProject,
        receipts=VisualCertificationReceipt,
        key=public_key,
        credential=credential,
        catalog=catalog,
        transport=transport,
        run_worker=run_worker,
        ready_probe=ready,
    )
    install_reference_runtime(
        app,
        service="visual",
        model=VisualCanvasReferenceMutation,
        public_key=public_key,
        credential=credential,
        transport=transport,
        run_worker=run_worker,
    )
    app.include_router(project_router)
    app.include_router(snapshot_router)
    app.include_router(composition_router)
    app.include_router(outputs_router)
    app.include_router(generation_catalog_router)
    app.include_router(acceptance_catalog_router)
    app.include_router(acceptance_options_router)
    app.include_router(acceptance_nodes_router)
    app.include_router(samples_router)
    app.include_router(review_authority_router)
    app.state.snapshot_authorization = LiveAuthorization(
        service="visual", credential=credential, transport=transport
    )
    app.state.capabilities = CapabilityClient(
        service="visual", credential=credential, catalog=catalog, transport=transport
    )
    if generation_key is not None and generation_key in {
        credential,
        archive_key,
        video_segment_key,
        segment_assets_key,
    }:
        raise ValueError("Visual 生成对等凭据必须独立")
    app.state.visual_generation_peer = (
        TimedPeer(generation_key, domain=PEER_DOMAIN) if generation_key is not None else None
    )
    app.state.generation_runner = (
        GenerationRunner(app.state) if generation_key is not None else None
    )
    app.include_router(generation_router)
    app.state.snapshot_settings = SnapshotSettings(state_root.resolve())
    app.state.snapshot_imports = None
    archive_delivery = None
    if archive_key is not None:
        if archive_key in {credential, video_segment_key, segment_assets_key}:
            raise ValueError("Visual 归档对等凭据必须独立")
        archive = ArchiveTransport(
            app.state.capabilities,
            archive_key,
            service="visual",
            purpose=ARCHIVE_PURPOSE,
            source_path=IMPORT,
            prefix=ARCHIVE_PREFIX,
            domain=ARCHIVE_DOMAIN,
            asset_model=SnapshotArchiveAsset,
            exact_mime=False,
        )
        archive_delivery = SnapshotDelivery(app.state.database.sessions, archive)
        app.state.snapshot_imports = SnapshotImports(app.state, archive, archive_delivery)
    app.include_router(standard_router, prefix="/v1")
    app.include_router(review_router, prefix="/v1")
    app.include_router(repair_router)
    app.include_router(
        generation_records_router, prefix="/v1", dependencies=[Depends(require_studio_auth)]
    )
    app.include_router(segment_target_router)
    app.include_router(segment_handoff_router)
    app.add_middleware(RequestLimit, prefix=VISUAL_HANDOFFS, maximum=16 * 1024)
    app.state.segment_handoffs = None
    app.state.video_segment_peer = None
    if video_segment_key is not None:
        bind_segment_handoffs(app, credential, video_segment_key, segment_assets_key, transport)
    if web_root is not None:
        release = load_release(web_root, "visual")
        if schema_path is None or release.api_sha256 != public_contract(
            json.loads(schema_path.read_text()), "visual", catalog
        ):
            raise ValueError("视觉创作工坊浏览器版本与发布契约不匹配")
        attach_web(app, release, pages=PAGES)
    composition_runner = CompositionRunner(app.state)
    app.state.composition_runner = composition_runner
    review_runner = ReviewRunner(app.state)
    app.state.review_runner = review_runner
    mounted = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/v1/")
        for method in operations
    }
    declared = {(op.method, op.path) for op in catalog.operations if op.service == "visual"}
    app.state.public_routes_complete = bool(declared) and declared == mounted
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_capability_client(instance):
        async with (
            app.state.capabilities.client,
            app.state.snapshot_authorization.client,
            lifespan(instance),
        ):
            await asyncio.to_thread(cleanup_snapshot_staging, app.state.snapshot_settings)
            try:
                if run_worker:
                    await composition_runner.start()
                    await review_runner.start()
                    if app.state.generation_runner is not None:
                        await app.state.generation_runner.start()
                    if archive_delivery is not None:
                        await archive_delivery.start()
                yield
            finally:
                if app.state.generation_runner is not None:
                    await app.state.generation_runner.stop()
                await review_runner.stop()
                await composition_runner.stop()
                if archive_delivery is not None:
                    await archive_delivery.stop()

    app.router.lifespan_context = with_capability_client
    return app


def bind_segment_handoffs(app, credential, video_key, assets_key, transport):
    client = httpx.AsyncClient(transport=transport, trust_env=False, timeout=10)
    identity = LiveAuthorization(service="visual", credential=credential, transport=transport)
    app.state.video_segment_peer = visual_peer(video_key)
    app.state.segment_handoffs = SegmentHandoffs(
        app.state.database, client, asset_peer(assets_key), identity
    )
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_segment_handoffs(instance):
        try:
            async with lifespan(instance):
                yield
        finally:
            await identity.close()
            await client.aclose()

    app.router.lifespan_context = with_segment_handoffs
